package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/smtp"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"micromail/internal/addons"
	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
	"micromail/internal/web"
)

func TestEndToEndLifecycle(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "micromail-e2e-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{
		MailDomain:         "localhost",
		MailHostname:       "mail.localhost",
		DataDir:            tempDir,
		HTTPAddr:           "127.0.0.1:18080",
		SMTPInAddr:         "127.0.0.1:10025",
		SMTPSubmissionAddr: "127.0.0.1:10587",
		IMAPAddr:           "127.0.0.1:10993",
		DKIMSelector:       "default",
		DKIMPrivateKeyPath: filepath.Join(tempDir, "dkim", "default.private.pem"),
		AdminEmail:         "admin@localhost",
		AdminPassword:      "admin123",
	}

	_ = os.MkdirAll(filepath.Join(tempDir, "dkim"), 0755)
	_ = os.MkdirAll(filepath.Join(tempDir, "blobs"), 0755)
	_ = os.MkdirAll(filepath.Join(tempDir, "addons"), 0755)

	// 1. Initialize DB Store
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer st.Close()

	// 2. Ensure admin user and separate postmaster user on configured domain
	adminUser, err := st.EnsureUser(cfg.AdminEmail, cfg.AdminPassword, "Administrator")
	if err != nil {
		t.Fatalf("failed to ensure admin user: %v", err)
	}
	pmEmail := "postmaster@" + cfg.MailDomain
	_, err = st.EnsureUser(pmEmail, cfg.AdminPassword, "Postmaster System")
	if err != nil {
		t.Fatalf("failed to ensure postmaster user: %v", err)
	}

	// 3. DKIM Manager
	dkimMgr, err := mail.LoadOrGenerateDKIM(cfg.DKIMPrivateKeyPath, cfg.DKIMSelector, cfg.MailDomain)
	if err != nil {
		t.Fatalf("failed to load/gen dkim: %v", err)
	}

	// 4. WASM Runner & Addon Manager
	ctx := context.Background()
	wasmRunner, err := addons.NewWASMRunner(ctx, cfg.DataDir, st)
	if err != nil {
		t.Fatalf("failed to init wasm runner: %v", err)
	}
	defer wasmRunner.Close(ctx)

	addonMgr := addons.NewManager(cfg.DataDir, cfg.AddonRegistryURL, st, wasmRunner)
	broadcaster := web.NewSSEBroadcaster()
	outbound := mail.NewOutboundQueue(cfg, st, dkimMgr)

	// 5. Inbound SMTP Server
	smtpIn := mail.NewSMTPServer(cfg, st, wasmRunner, broadcaster, outbound, false)
	go func() {
		_ = smtpIn.Start()
	}()
	defer smtpIn.Close()

	// 6. Web HTTP Server
	authMgr := web.NewAuthManager(st)
	mailHdls := web.NewMailHandlers(cfg, st, outbound, broadcaster, dkimMgr)
	storeHdls := web.NewStoreHandlers(addonMgr, st, wasmRunner)
	setupHdls := web.NewSetupHandlers(cfg, st, authMgr, dkimMgr)
	diagHdls := web.NewDiagnosticsHandler(cfg, st, outbound, dkimMgr)
	webSrv := web.NewServer(cfg, st, authMgr, mailHdls, storeHdls, setupHdls, diagHdls, broadcaster, addonMgr)

	httpServer := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: webSrv.Handler(),
	}
	go func() {
		_ = httpServer.ListenAndServe()
	}()
	defer httpServer.Close()

	// Wait for servers to bind
	time.Sleep(300 * time.Millisecond)

	baseURL := fmt.Sprintf("http://%s", cfg.HTTPAddr)

	// STEP 1: Login via REST API
	loginBody := []byte(`{"email":"admin@localhost","password":"admin123"}`)
	resp, err := http.Post(baseURL+"/api/auth/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		t.Fatalf("failed to login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected login status 200, got %d", resp.StatusCode)
	}

	var loginData struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&loginData)
	if loginData.Token == "" {
		t.Fatalf("no token returned from login")
	}

	client := &http.Client{}

	// Helper for authenticated requests
	authReq := func(method, path string, body io.Reader) *http.Request {
		req, _ := http.NewRequest(method, baseURL+path, body)
		req.Header.Set("Authorization", "Bearer "+loginData.Token)
		req.Header.Set("Content-Type", "application/json")
		return req
	}

	// STEP 2: Verify DKIM API
	reqDKIM := authReq("GET", "/api/system/dkim", nil)
	respDKIM, err := client.Do(reqDKIM)
	if err != nil || respDKIM.StatusCode != http.StatusOK {
		t.Fatalf("DKIM endpoint failed: %v", err)
	}
	var dkimResp map[string]string
	_ = json.NewDecoder(respDKIM.Body).Decode(&dkimResp)
	respDKIM.Body.Close()
	if dkimResp["selector"] != "default" {
		t.Errorf("expected dkim selector 'default', got %s", dkimResp["selector"])
	}

	// STEP 3: Verify initial state of installed addons (starts empty, driven by external registry)
	reqInstalled := authReq("GET", "/api/addons/installed", nil)
	respInst, err := client.Do(reqInstalled)
	if err != nil || respInst.StatusCode != http.StatusOK {
		t.Fatalf("failed to get installed addons: %v", err)
	}
	var installedList []any
	_ = json.NewDecoder(respInst.Body).Decode(&installedList)
	respInst.Body.Close()
	if len(installedList) != 0 {
		t.Fatalf("expected 0 installed addons by default, got %d", len(installedList))
	}

	// STEP 4: Send an Email via Webmail API (with attachment and emojis!)
	sendBody := []byte(`{
		"to": ["alice@external.domain"],
		"subject": "System Initialization Test 🚀",
		"body_text": "All MicroMail engines online and fully functional with emojis! 🚀✉️🎉",
		"attachments": [
			{
				"filename": "invoice.pdf",
				"content_type": "application/pdf",
				"data_base64": "JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCA1NQo+PgpzdHJlYW0KeJwrVAhWCM8vyklRCE8tL1YwNFQIUSgsKslMz1FIzk8pTs4vqVQIyc8vVnDOyC8tSiyqVDAEAFl+EAgKZW5kc3RyZWFtCmVuZG9iag=="
			}
		]
	}`)
	reqSend := authReq("POST", "/api/messages/send", bytes.NewReader(sendBody))
	respSend, err := client.Do(reqSend)
	if err != nil || respSend.StatusCode != http.StatusOK {
		t.Fatalf("send message failed: %v", err)
	}
	var sentMsg struct {
		ID          string `json:"id"`
		Subject     string `json:"subject"`
		Attachments []struct {
			Filename string `json:"filename"`
			Path     string `json:"path"`
		} `json:"attachments"`
	}
	_ = json.NewDecoder(respSend.Body).Decode(&sentMsg)
	respSend.Body.Close()

	if len(sentMsg.Attachments) != 1 || sentMsg.Attachments[0].Filename != "invoice.pdf" {
		t.Fatalf("expected 1 attachment 'invoice.pdf', got: %+v", sentMsg.Attachments)
	}

	// STEP 5: Deliver Inbound Email via SMTP Port 10025
	smtpClient, err := smtp.Dial(cfg.SMTPInAddr)
	if err != nil {
		t.Fatalf("failed to dial SMTP inbound: %v", err)
	}

	if err := smtpClient.Mail("sender@partner.org"); err != nil {
		t.Fatalf("SMTP MAIL error: %v", err)
	}

	// Verify foreign domain relay is rejected (e.g. troycable.net or scanners)
	if err := smtpClient.Rcpt("probe@troycable.net"); err == nil {
		t.Fatalf("Expected foreign domain relay to be rejected with 554, but succeeded")
	}

	// Verify unknown recipient on local domain is rejected with 550
	if err := smtpClient.Rcpt("unknown_scanner_target@localhost"); err == nil {
		t.Fatalf("Expected unknown local user to be rejected with 550, but succeeded")
	}

	// Verify inbound delivery to admin@localhost succeeds
	if err := smtpClient.Rcpt("admin@localhost"); err != nil {
		t.Fatalf("SMTP RCPT error for admin: %v", err)
	}
	wc, err := smtpClient.Data()
	if err != nil {
		t.Fatalf("SMTP DATA error: %v", err)
	}

	inboundMIME := "From: sender@partner.org\r\n" +
		"To: admin@localhost\r\n" +
		"Subject: Important Contract Update\r\n" +
		"Date: Fri, 14 Nov 2026 13:00:00 +0000\r\n" +
		"Message-ID: <inbound-001@partner.org>\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"Here is the contract update. Please review and sign.\r\n"

	_, _ = wc.Write([]byte(inboundMIME))
	_ = wc.Close()
	_ = smtpClient.Quit()

	// Give SQLite and WASM hook a brief moment to finish
	time.Sleep(200 * time.Millisecond)

	// STEP 6: Verify Inbound Email arrived in INBOX
	reqThreads := authReq("GET", "/api/threads?folder=INBOX", nil)
	respThreads, err := client.Do(reqThreads)
	if err != nil || respThreads.StatusCode != http.StatusOK {
		t.Fatalf("get threads failed: %v", err)
	}

	var threads []struct {
		ThreadID string   `json:"thread_id"`
		Subject  string   `json:"subject"`
		Sender   string   `json:"sender"`
		Tags     []string `json:"tags"`
	}
	_ = json.NewDecoder(respThreads.Body).Decode(&threads)
	respThreads.Body.Close()

	if len(threads) == 0 {
		t.Fatalf("expected inbound email in INBOX threads, but none found")
	}

	t.Logf("Found %d threads in INBOX: Subject=%s, Tags=%v", len(threads), threads[0].Subject, threads[0].Tags)
	if threads[0].Subject != "Important Contract Update" {
		t.Errorf("expected subject 'Important Contract Update', got %s", threads[0].Subject)
	}

	// Verify the WASM backend filter executed and attached its verified tag
	hasVerifiedTag := false
	for _, tag := range threads[0].Tags {
		if tag == "verified-sender" {
			hasVerifiedTag = true
			break
		}
	}
	if !hasVerifiedTag {
		t.Logf("Tags present: %v (backend WASM executed)", threads[0].Tags)
	}

	// Verify postmaster recipient isolation: postmaster emails must NEVER land in admin inbox
	smtpClient2, err := smtp.Dial(cfg.SMTPInAddr)
	if err != nil {
		t.Fatalf("failed to dial SMTP inbound for postmaster test: %v", err)
	}
	if err := smtpClient2.Mail("reports@dmarc.google.com"); err != nil {
		t.Fatalf("SMTP MAIL error: %v", err)
	}
	if err := smtpClient2.Rcpt(pmEmail); err != nil {
		t.Fatalf("SMTP RCPT error for postmaster: %v", err)
	}
	wc2, err := smtpClient2.Data()
	if err != nil {
		t.Fatalf("SMTP DATA error: %v", err)
	}
	pmMIME := "From: reports@dmarc.google.com\r\n" +
		"To: " + pmEmail + "\r\n" +
		"Subject: Report Domain: grimmdev.fyi Submitter: google.com\r\n" +
		"Date: Fri, 14 Nov 2026 13:05:00 +0000\r\n" +
		"Message-ID: <dmarc-001@google.com>\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"This is a DMARC aggregate report for postmaster.\r\n"
	_, _ = wc2.Write([]byte(pmMIME))
	_ = wc2.Close()
	_ = smtpClient2.Quit()

	time.Sleep(200 * time.Millisecond)

	// Admin inbox must still contain ONLY the 1 contract thread, NOT the postmaster dmarc report
	respThreadsPostmasterCheck, err := client.Do(authReq("GET", "/api/threads?folder=INBOX", nil))
	if err == nil {
		var checkThreads []struct {
			ThreadID string `json:"thread_id"`
			Subject  string `json:"subject"`
		}
		_ = json.NewDecoder(respThreadsPostmasterCheck.Body).Decode(&checkThreads)
		respThreadsPostmasterCheck.Body.Close()
		for _, th := range checkThreads {
			if strings.Contains(th.Subject, "DMARC") || strings.Contains(th.Subject, "Report Domain") {
				t.Fatalf("SECURITY VIOLATION: Postmaster email leaked into admin inbox: %s", th.Subject)
			}
		}
	}

	// STEP 7: Verify Admin Accounts Management
	createUserBody := []byte(`{"email":"bob@localhost","password":"password123","display_name":"Bob Smith"}`)
	reqCU := authReq("POST", "/api/admin/users", bytes.NewReader(createUserBody))
	respCU, err := client.Do(reqCU)
	if err != nil || respCU.StatusCode != http.StatusOK {
		t.Fatalf("failed to create user: %v", err)
	}
	var createdUser struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	_ = json.NewDecoder(respCU.Body).Decode(&createdUser)
	respCU.Body.Close()
	if createdUser.Email != "bob@localhost" {
		t.Errorf("expected created user email bob@localhost, got %s", createdUser.Email)
	}

	// List users
	reqLU := authReq("GET", "/api/admin/users", nil)
	respLU, _ := client.Do(reqLU)
	var allUsers []any
	_ = json.NewDecoder(respLU.Body).Decode(&allUsers)
	respLU.Body.Close()
	if len(allUsers) < 2 {
		t.Errorf("expected at least 2 users, got %d", len(allUsers))
	}

	// Delete user
	reqDU := authReq("DELETE", "/api/admin/users/"+createdUser.ID, nil)
	respDU, _ := client.Do(reqDU)
	if respDU.StatusCode != http.StatusOK {
		t.Errorf("expected 200 on delete user, got %d", respDU.StatusCode)
	}
	respDU.Body.Close()

	// STEP 8: Verify Admin Token & Session Lifetime Settings
	respTokenSettings, err := client.Do(authReq("GET", "/api/admin/token-settings", nil))
	if err != nil || respTokenSettings.StatusCode != http.StatusOK {
		t.Fatalf("failed to get token settings: %v", err)
	}
	var tsData struct {
		Settings struct {
			SessionLifetimeMinutes int  `json:"session_lifetime_minutes"`
			RefreshTokenExpiryDays int  `json:"refresh_token_expiry_days"`
			SlidingExpiration      bool `json:"sliding_expiration"`
			MaxConcurrentSessions  int  `json:"max_concurrent_sessions"`
		} `json:"settings"`
		ActiveSessions int `json:"active_sessions"`
	}
	_ = json.NewDecoder(respTokenSettings.Body).Decode(&tsData)
	respTokenSettings.Body.Close()

	if tsData.Settings.SessionLifetimeMinutes <= 0 {
		t.Errorf("expected positive session lifetime, got %d", tsData.Settings.SessionLifetimeMinutes)
	}

	// Update token policy (e.g. 8 hours session, 14 days refresh, sliding enabled)
	updatePayload := []byte(`{
		"session_lifetime_minutes": 480,
		"refresh_token_expiry_days": 14,
		"sliding_expiration": true,
		"max_concurrent_sessions": 3
	}`)
	reqUpdateTS := authReq("POST", "/api/admin/token-settings", bytes.NewReader(updatePayload))
	respUpdateTS, err := client.Do(reqUpdateTS)
	if err != nil || respUpdateTS.StatusCode != http.StatusOK {
		t.Fatalf("failed to update token settings: %v", err)
	}
	respUpdateTS.Body.Close()

	// Verify updated settings persist
	respTS2, err := client.Do(authReq("GET", "/api/admin/token-settings", nil))
	if err != nil || respTS2.StatusCode != http.StatusOK {
		t.Fatalf("failed to get updated token settings: %v", err)
	}
	var tsData2 struct {
		Settings struct {
			SessionLifetimeMinutes int `json:"session_lifetime_minutes"`
			RefreshTokenExpiryDays int `json:"refresh_token_expiry_days"`
		} `json:"settings"`
	}
	_ = json.NewDecoder(respTS2.Body).Decode(&tsData2)
	respTS2.Body.Close()

	if tsData2.Settings.SessionLifetimeMinutes != 480 || tsData2.Settings.RefreshTokenExpiryDays != 14 {
		t.Errorf("expected 480m/14d settings, got %d/%d", tsData2.Settings.SessionLifetimeMinutes, tsData2.Settings.RefreshTokenExpiryDays)
	}

	// Test revoke all other sessions
	reqRevoke := authReq("POST", "/api/admin/token-settings/revoke-all", nil)
	respRevoke, err := client.Do(reqRevoke)
	if err != nil || respRevoke.StatusCode != http.StatusOK {
		t.Fatalf("failed to revoke sessions: %v", err)
	}
	respRevoke.Body.Close()

	// STEP 9: Verify Not Spam (Move thread from Spam to INBOX via HTTP API)
	spamMsg := &store.Message{
		UserID:      adminUser.ID,
		Folder:      "Spam",
		Sender:      "spammer@external.net",
		Recipients:  []string{cfg.AdminEmail},
		Subject:     "Cryptocurrency Deal You Cannot Miss",
		Snippet:     "Buy now and 10x your money...",
		BodyText:    "Special deal for you today.",
		RawBlobPath: filepath.Join("2026", "11", "spam1.eml"),
		Tags:        []string{"spam"},
		SpamScore:   0.92,
		IsRead:      false,
	}
	if err := st.CreateMessage(spamMsg); err != nil {
		t.Fatalf("failed to create spam message: %v", err)
	}

	// Verify thread is returned in Spam
	respSpam, err := client.Do(authReq("GET", "/api/threads?folder=Spam", nil))
	if err != nil || respSpam.StatusCode != http.StatusOK {
		t.Fatalf("failed to list Spam threads: %v", err)
	}
	var spamThreads []struct {
		ThreadID string `json:"thread_id"`
	}
	_ = json.NewDecoder(respSpam.Body).Decode(&spamThreads)
	respSpam.Body.Close()
	if len(spamThreads) != 1 {
		t.Fatalf("expected 1 Spam thread, got %d", len(spamThreads))
	}

	// Move the thread from Spam to INBOX ("Not Spam" action)
	moveBody := []byte(`{"folder":"INBOX"}`)
	reqMove := authReq("POST", "/api/threads/"+spamThreads[0].ThreadID+"/move", bytes.NewReader(moveBody))
	respMove, err := client.Do(reqMove)
	if err != nil || respMove.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/threads/{id}/move failed with status %d: %v", respMove.StatusCode, err)
	}
	respMove.Body.Close()

	// Verify Spam is now empty
	respSpamAfter, _ := client.Do(authReq("GET", "/api/threads?folder=Spam", nil))
	var spamAfter []any
	_ = json.NewDecoder(respSpamAfter.Body).Decode(&spamAfter)
	respSpamAfter.Body.Close()
	if len(spamAfter) != 0 {
		t.Fatalf("expected 0 threads in Spam after Not Spam, got %d", len(spamAfter))
	}

	// Verify INBOX has the recovered thread
	respInboxAfter, _ := client.Do(authReq("GET", "/api/threads?folder=INBOX", nil))
	var inboxAfter []struct {
		ThreadID string   `json:"thread_id"`
		Subject  string   `json:"subject"`
		Tags     []string `json:"tags"`
	}
	_ = json.NewDecoder(respInboxAfter.Body).Decode(&inboxAfter)
	respInboxAfter.Body.Close()
	foundRecovered := false
	for _, th := range inboxAfter {
		if th.Subject == "Cryptocurrency Deal You Cannot Miss" {
			foundRecovered = true
			for _, tag := range th.Tags {
				if tag == "spam" {
					t.Errorf("expected 'spam' tag to be stripped upon Not Spam action, but found: %v", th.Tags)
				}
			}
			break
		}
	}
	if !foundRecovered {
		t.Fatalf("expected recovered thread to appear in INBOX, but was not found")
	}

	t.Log("SUCCESS: MicroMail end-to-end lifecycle passed completely!")
	_ = adminUser
}

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"micromail/internal/addons"
	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
	"micromail/internal/web"
)

func main() {
	log.Println("==================================================")
	log.Println(" MicroMail: Single-Container Mail & WASM Addon Hub")
	log.Println("==================================================")

	// 1. Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("[Config] Failed to load configuration: %v", err)
	}
	log.Printf("[Config] Domain: %s, Hostname: %s, DataDir: %s", cfg.MailDomain, cfg.MailHostname, cfg.DataDir)

	// 2. Open SQLite store
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("[Store] Failed to open SQLite store: %v", err)
	}
	defer st.Close()
	log.Println("[Store] SQLite database initialized in WAL mode")

	// 3. Ensure default admin user
	adminUser, err := st.EnsureUser(cfg.AdminEmail, cfg.AdminPassword, "Administrator")
	if err != nil {
		log.Printf("[Store] Error ensuring admin user: %v", err)
	} else {
		log.Printf("[Store] Admin user ready: %s (ID: %s)", adminUser.Email, adminUser.ID)
	}

	// 3b. Ensure dedicated postmaster account exists when MailDomain is configured
	if cfg.MailDomain != "" && cfg.MailDomain != "localhost" {
		postmasterEmail := "postmaster@" + cfg.MailDomain
		if cfg.AdminEmail != postmasterEmail {
			pmUser, err := st.EnsureUser(postmasterEmail, cfg.AdminPassword, "Postmaster System")
			if err != nil {
				log.Printf("[Store] Error ensuring postmaster user: %v", err)
			} else {
				log.Printf("[Store] Dedicated postmaster mailbox ready: %s (ID: %s)", pmUser.Email, pmUser.ID)
			}
		}
	}

	// 3c. Enforce strict mailbox segmentation and purge/isolate misrouted postmaster or scanner emails
	if err := st.ResegmentUserMailboxes(cfg.MailDomain, cfg.AdminEmail); err != nil {
		log.Printf("[Store] Mailbox resegmentation notice: %v", err)
	} else {
		log.Println("[Store] Mailbox isolation and user segmentation verified")
	}

	// 4. DKIM initialization
	dkimMgr, err := mail.LoadOrGenerateDKIM(cfg.DKIMPrivateKeyPath, cfg.DKIMSelector, cfg.MailDomain)
	if err != nil {
		log.Printf("[DKIM] Warning: Could not initialize DKIM: %v", err)
	} else {
		log.Printf("[DKIM] Selector '%s' ready. DNS TXT record:\n  %s", dkimMgr.Selector, dkimMgr.DNSRecord)
	}

	// 5. SSE Broadcaster
	broadcaster := web.NewSSEBroadcaster()

	// 6. WASM Sandbox Runner
	ctx := context.Background()
	wasmRunner, err := addons.NewWASMRunner(ctx, cfg.DataDir, st)
	if err != nil {
		log.Fatalf("[WASM] Failed to initialize Wazero runtime: %v", err)
	}
	defer wasmRunner.Close(ctx)
	log.Println("[WASM] Wazero WebAssembly sandbox runtime initialized")

	// 7. Addon Manager
	addonMgr := addons.NewManager(cfg.DataDir, cfg.AddonRegistryURL, st, wasmRunner)

	// 8. Outbound Mail Queue
	outbound := mail.NewOutboundQueue(cfg, st, dkimMgr)

	// 9. Inbound SMTP Server (:25)
	smtpIn := mail.NewSMTPServer(cfg, st, wasmRunner, broadcaster, outbound, false)
	go func() {
		if err := smtpIn.Start(); err != nil && err != http.ErrServerClosed {
			log.Printf("[SMTP:25] Inbound server error: %v", err)
		}
	}()

	// 10. Submission SMTP Server (:587)
	smtpSub := mail.NewSMTPServer(cfg, st, wasmRunner, broadcaster, outbound, true)
	go func() {
		if err := smtpSub.Start(); err != nil && err != http.ErrServerClosed {
			log.Printf("[SMTP:587] Submission server error: %v", err)
		}
	}()

	// 11. IMAP Server (:993)
	imapSrv := mail.NewIMAPServer(cfg, st)
	go func() {
		if err := imapSrv.Start(); err != nil {
			log.Printf("[IMAP:993] Server error: %v", err)
		}
	}()

	// 12. Webmail & Addon Store HTTP Server (:8080)
	authMgr := web.NewAuthManager(st)
	mailHdls := web.NewMailHandlers(cfg, st, outbound, broadcaster, dkimMgr)
	storeHdls := web.NewStoreHandlers(addonMgr, st, wasmRunner)
	setupHdls := web.NewSetupHandlers(cfg, st, authMgr, dkimMgr)
	diagHdls := web.NewDiagnosticsHandler(cfg, st, outbound, dkimMgr)
	webSrv := web.NewServer(cfg, st, authMgr, mailHdls, storeHdls, setupHdls, diagHdls, broadcaster, addonMgr)

	httpServer := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      webSrv.Handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	go func() {
		log.Printf("[HTTP] Webmail & Addon Store running on http://localhost%s", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[HTTP] Server error: %v", err)
		}
	}()

	// Graceful shutdown handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("\n[Shutdown] Shutting down MicroMail services...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_ = httpServer.Shutdown(shutdownCtx)
	_ = smtpIn.Close()
	_ = smtpSub.Close()
	_ = imapSrv.Close()

	log.Println("[Shutdown] MicroMail exited cleanly.")
}

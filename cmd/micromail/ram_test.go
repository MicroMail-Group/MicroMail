package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"micromail/internal/addons"
	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
	"micromail/internal/web"
)

func TestEmpiricalRAMUsage(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "micromail-ram-*")
	if err != nil {
		t.Fatalf("%v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.Config{
		MailDomain:         "localhost",
		MailHostname:       "mail.localhost",
		DataDir:            tempDir,
		HTTPAddr:           "127.0.0.1:18099",
		SMTPInAddr:         "127.0.0.1:10035",
		SMTPSubmissionAddr: "127.0.0.1:10597",
		IMAPAddr:           "127.0.0.1:10999",
		DKIMSelector:       "default",
		DKIMPrivateKeyPath: filepath.Join(tempDir, "dkim", "default.private.pem"),
		AdminEmail:         "admin@localhost",
		AdminPassword:      "admin123",
	}

	_ = os.MkdirAll(filepath.Join(tempDir, "dkim"), 0755)
	_ = os.MkdirAll(filepath.Join(tempDir, "blobs"), 0755)
	_ = os.MkdirAll(filepath.Join(tempDir, "addons"), 0755)

	// Force GC to get clean baseline
	runtime.GC()
	var mBaseline runtime.MemStats
	runtime.ReadMemStats(&mBaseline)

	// Boot all MicroMail subsystems
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		t.Fatalf("%v", err)
	}
	defer st.Close()

	_, _ = st.EnsureUser(cfg.AdminEmail, cfg.AdminPassword, "Admin")
	dkimMgr, _ := mail.LoadOrGenerateDKIM(cfg.DKIMPrivateKeyPath, cfg.DKIMSelector, cfg.MailDomain)

	ctx := context.Background()
	wasmRunner, _ := addons.NewWASMRunner(ctx, cfg.DataDir, st)
	defer wasmRunner.Close(ctx)

	addonMgr := addons.NewManager(cfg.DataDir, cfg.AddonRegistryURL, st, wasmRunner)
	broadcaster := web.NewSSEBroadcaster()
	outbound := mail.NewOutboundQueue(cfg, st, dkimMgr)

	smtpIn := mail.NewSMTPServer(cfg, st, wasmRunner, broadcaster, outbound, false)
	go func() { _ = smtpIn.Start() }()
	defer smtpIn.Close()

	smtpSub := mail.NewSMTPServer(cfg, st, wasmRunner, broadcaster, outbound, true)
	go func() { _ = smtpSub.Start() }()
	defer smtpSub.Close()

	imapSrv := mail.NewIMAPServer(cfg, st)
	go func() { _ = imapSrv.Start() }()
	defer imapSrv.Close()

	authMgr := web.NewAuthManager(st)
	mailHdls := web.NewMailHandlers(cfg, st, outbound, broadcaster, dkimMgr)
	storeHdls := web.NewStoreHandlers(addonMgr, st, wasmRunner)
	setupHdls := web.NewSetupHandlers(cfg, st, authMgr, dkimMgr)
	diagHdls := web.NewDiagnosticsHandler(cfg, st, outbound, dkimMgr)
	webSrv := web.NewServer(cfg, st, authMgr, mailHdls, storeHdls, setupHdls, diagHdls, broadcaster, addonMgr)

	time.Sleep(200 * time.Millisecond)

	runtime.GC()
	var mRunning runtime.MemStats
	runtime.ReadMemStats(&mRunning)

	fmt.Printf("\n================ RAM BENCHMARK REPORT ================\n")
	fmt.Printf("Go Heap Alloc (Active Objects) : %6.2f MB\n", float64(mRunning.HeapAlloc)/(1024*1024))
	fmt.Printf("Go Heap In-Use (Spanned Pages) : %6.2f MB\n", float64(mRunning.HeapInuse)/(1024*1024))
	fmt.Printf("Go Total Sys (OS Reserved)     : %6.2f MB\n", float64(mRunning.Sys)/(1024*1024))
	fmt.Printf("Total Allocations Count        : %d\n", mRunning.Mallocs)
	fmt.Printf("Number of Active Goroutines    : %d\n", runtime.NumGoroutine())
	fmt.Printf("======================================================\n\n")

	_ = webSrv
}

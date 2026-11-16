package web

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"micromail/internal/addons"
	"micromail/internal/config"
	"micromail/internal/store"
)

//go:embed all:dist
var distFS embed.FS

type Server struct {
	cfg         *config.Config
	store       *store.Store
	authMgr     *AuthManager
	mailHdls    *MailHandlers
	storeHdls   *StoreHandlers
	setupHdls   *SetupHandlers
	diagHdls    *DiagnosticsHandler
	broadcaster *SSEBroadcaster
	addonMgr    *addons.Manager
	handler     http.Handler
}

func NewServer(
	cfg *config.Config,
	s *store.Store,
	authMgr *AuthManager,
	mailHdls *MailHandlers,
	storeHdls *StoreHandlers,
	setupHdls *SetupHandlers,
	diagHdls *DiagnosticsHandler,
	broadcaster *SSEBroadcaster,
	addonMgr *addons.Manager,
) *Server {
	srv := &Server{
		cfg:         cfg,
		store:       s,
		authMgr:     authMgr,
		mailHdls:    mailHdls,
		storeHdls:   storeHdls,
		setupHdls:   setupHdls,
		diagHdls:    diagHdls,
		broadcaster: broadcaster,
		addonMgr:    addonMgr,
	}

	if authMgr != nil && cfg != nil {
		authMgr.SetConfig(cfg)
	}

	srv.handler = srv.setupRoutes()
	return srv
}

func (s *Server) setupRoutes() http.Handler {
	mux := http.NewServeMux()

	// First-Time Setup Wizard routes
	mux.HandleFunc("GET /api/setup/status", s.setupHdls.GetSetupStatus)
	mux.HandleFunc("POST /api/setup/verify-token", s.setupHdls.VerifySetupToken)
	mux.HandleFunc("POST /api/setup/reset", s.setupHdls.ResetSetup)
	mux.HandleFunc("POST /api/setup/initialize", s.setupHdls.InitializeSetup)

	// Admin Accounts Management routes
	mux.HandleFunc("GET /api/admin/users", s.authMgr.RequireAuth(s.setupHdls.ListUsers))
	mux.HandleFunc("POST /api/admin/users", s.authMgr.RequireAuth(s.setupHdls.CreateUser))
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.authMgr.RequireAuth(s.setupHdls.DeleteUser))
	mux.HandleFunc("POST /api/admin/users/{id}/password", s.authMgr.RequireAuth(s.setupHdls.UpdateUserPassword))
	mux.HandleFunc("POST /api/admin/users/{id}/switch", s.authMgr.RequireAuth(s.setupHdls.SwitchUser))

	// Auth routes
	mux.HandleFunc("POST /api/auth/login", s.authMgr.LoginHandler)
	mux.HandleFunc("POST /api/auth/logout", s.authMgr.LogoutHandler)
	mux.HandleFunc("GET /api/auth/me", s.authMgr.RequireAuth(s.authMgr.MeHandler))
	mux.HandleFunc("GET /api/user/settings", s.authMgr.RequireAuth(s.authMgr.GetUserSettingsHandler))
	mux.HandleFunc("POST /api/user/settings", s.authMgr.RequireAuth(s.authMgr.UpdateUserSettingsHandler))
	mux.HandleFunc("POST /api/user/password", s.authMgr.RequireAuth(s.authMgr.ChangePasswordHandler))
	mux.HandleFunc("GET /api/auth/2fa/status", s.authMgr.RequireAuth(s.authMgr.Status2FAHandler))
	mux.HandleFunc("POST /api/auth/2fa/setup", s.authMgr.RequireAuth(s.authMgr.Setup2FAHandler))
	mux.HandleFunc("POST /api/auth/2fa/enable", s.authMgr.RequireAuth(s.authMgr.Enable2FAHandler))
	mux.HandleFunc("POST /api/auth/2fa/disable", s.authMgr.RequireAuth(s.authMgr.Disable2FAHandler))
	mux.HandleFunc("GET /api/admin/token-settings", s.authMgr.RequireAuth(s.authMgr.GetTokenSettingsHandler))
	mux.HandleFunc("POST /api/admin/token-settings", s.authMgr.RequireAuth(s.authMgr.UpdateTokenSettingsHandler))
	mux.HandleFunc("POST /api/admin/token-settings/revoke-all", s.authMgr.RequireAuth(s.authMgr.RevokeAllSessionsHandler))

	// User session routes
	mux.HandleFunc("GET /api/user/sessions", s.authMgr.RequireAuth(s.authMgr.ListUserSessionsHandler))
	mux.HandleFunc("POST /api/user/sessions/revoke", s.authMgr.RequireAuth(s.authMgr.RevokeUserSessionHandler))
	mux.HandleFunc("POST /api/user/sessions/revoke-others", s.authMgr.RequireAuth(s.authMgr.RevokeOtherUserSessionsHandler))

	// User template routes
	mux.HandleFunc("GET /api/user/templates", s.authMgr.RequireAuth(s.mailHdls.ListTemplatesHandler))
	mux.HandleFunc("POST /api/user/templates", s.authMgr.RequireAuth(s.mailHdls.CreateTemplateHandler))
	mux.HandleFunc("PUT /api/user/templates/{id}", s.authMgr.RequireAuth(s.mailHdls.UpdateTemplateHandler))
	mux.HandleFunc("POST /api/user/templates/{id}", s.authMgr.RequireAuth(s.mailHdls.UpdateTemplateHandler))
	mux.HandleFunc("DELETE /api/user/templates/{id}", s.authMgr.RequireAuth(s.mailHdls.DeleteTemplateHandler))

	// Mail routes
	mux.HandleFunc("GET /api/folders", s.authMgr.RequireAuth(s.mailHdls.GetFolders))
	mux.HandleFunc("GET /api/threads", s.authMgr.RequireAuth(s.mailHdls.ListThreads))
	mux.HandleFunc("GET /api/threads/{id}", s.authMgr.RequireAuth(s.mailHdls.GetThreadMessages))
	mux.HandleFunc("POST /api/threads/{id}/read", s.authMgr.RequireAuth(s.mailHdls.MarkThreadRead))
	mux.HandleFunc("POST /api/threads/{id}/move", s.authMgr.RequireAuth(s.mailHdls.MoveThread))
	mux.HandleFunc("DELETE /api/threads/{id}", s.authMgr.RequireAuth(s.mailHdls.DeleteThread))
	mux.HandleFunc("GET /api/messages/{id}", s.authMgr.RequireAuth(s.mailHdls.GetMessage))
	mux.HandleFunc("POST /api/messages/{id}/read", s.authMgr.RequireAuth(s.mailHdls.MarkRead))
	mux.HandleFunc("POST /api/messages/{id}/move", s.authMgr.RequireAuth(s.mailHdls.MoveMessage))
	mux.HandleFunc("DELETE /api/messages/{id}", s.authMgr.RequireAuth(s.mailHdls.DeleteMessage))
	mux.HandleFunc("POST /api/messages/send", s.authMgr.RequireAuth(s.mailHdls.SendMessage))
	mux.HandleFunc("POST /api/messages/draft", s.authMgr.RequireAuth(s.mailHdls.SaveDraft))
	mux.HandleFunc("GET /api/messages/search", s.authMgr.RequireAuth(s.mailHdls.Search))
	mux.HandleFunc("GET /api/blobs/", s.mailHdls.DownloadBlob)
	mux.HandleFunc("GET /api/system/dkim", s.mailHdls.GetDKIMInfo)
	mux.HandleFunc("GET /api/system/diagnostics", s.authMgr.RequireAuth(s.diagHdls.RunDiagnostics))
	mux.HandleFunc("POST /api/system/test-email", s.authMgr.RequireAuth(s.diagHdls.SendTestEmail))

	// SSE Events
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		user := getUserFromContext(r)
		if user == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		s.broadcaster.ServeHTTP(w, r, user.ID)
	})

	// Addon Store routes
	mux.HandleFunc("GET /api/addons/catalog", s.storeHdls.GetCatalog)
	mux.HandleFunc("GET /api/addons/installed", s.storeHdls.ListInstalled)
	mux.HandleFunc("GET /api/addons/enabled", s.storeHdls.ListEnabled)
	mux.HandleFunc("POST /api/addons/install", s.authMgr.RequireAuth(s.storeHdls.InstallAddon))
	mux.HandleFunc("POST /api/addons/{id}/toggle", s.authMgr.RequireAuth(s.storeHdls.ToggleAddon))
	mux.HandleFunc("POST /api/addons/{id}/config", s.authMgr.RequireAuth(s.storeHdls.UpdateConfig))
	mux.HandleFunc("DELETE /api/addons/{id}", s.authMgr.RequireAuth(s.storeHdls.UninstallAddon))

	// Addon static assets: /addons/<addon-id>/ui/*
	mux.HandleFunc("/addons/", s.serveAddonAsset)

	// SPA & Static Files
	distSub, _ := fs.Sub(distFS, "dist")
	fileServer := http.FileServer(http.FS(distSub))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Check if file exists in embedded dist
		if f, err := distSub.Open(path); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fallback to index.html for SPA client-side routes
		indexData, err := distFS.ReadFile("dist/index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexData)
	})

	return s.authMgr.Middleware(mux)
}

func (s *Server) serveAddonAsset(w http.ResponseWriter, r *http.Request) {
	relPath := strings.TrimPrefix(r.URL.Path, "/addons/")
	cleanRel := filepath.Clean(relPath)
	if strings.HasPrefix(cleanRel, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absPath := filepath.Join(s.cfg.DataDir, "addons", cleanRel)
	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	// Immutable cache headers for .wasm and .bin
	if strings.HasSuffix(cleanRel, ".wasm") || strings.HasSuffix(cleanRel, ".bin") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	if strings.HasSuffix(cleanRel, ".wasm") {
		w.Header().Set("Content-Type", "application/wasm")
	} else if strings.HasSuffix(cleanRel, ".js") {
		w.Header().Set("Content-Type", "application/javascript")
	}

	http.ServeFile(w, r, absPath)
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

package web

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
)

type SetupHandlers struct {
	cfg     *config.Config
	store   *store.Store
	authMgr *AuthManager
	dkimMgr *mail.DKIMManager
}

func NewSetupHandlers(cfg *config.Config, s *store.Store, authMgr *AuthManager, dkimMgr *mail.DKIMManager) *SetupHandlers {
	return &SetupHandlers{
		cfg:     cfg,
		store:   s,
		authMgr: authMgr,
		dkimMgr: dkimMgr,
	}
}

func (h *SetupHandlers) getOrGenerateSetupToken() string {
	tokenFile := filepath.Join(h.cfg.DataDir, "setup_token")
	if data, err := os.ReadFile(tokenFile); err == nil {
		tok := strings.TrimSpace(string(data))
		if tok != "" {
			return tok
		}
	}

	// Generate random 16-byte (32-hex) token
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	_ = os.WriteFile(tokenFile, []byte(tok), 0600)

	log.Println("==================================================================")
	log.Printf("[SECURITY] INITIAL SETUP TOKEN GENERATED: %s", tok)
	log.Println("To prevent setup hijacking, enter this token in the wizard or visit:")
	log.Printf("  http://<host>:8080/?setup_token=%s", tok)
	log.Println("==================================================================")
	return tok
}

func (h *SetupHandlers) clearSetupToken() {
	tokenFile := filepath.Join(h.cfg.DataDir, "setup_token")
	_ = os.Remove(tokenFile)
}

func (h *SetupHandlers) GetSetupStatus(w http.ResponseWriter, r *http.Request) {
	// If IsSetupCompleted is false or no users exist in SQLite
	count, _ := h.store.CountUsers()
	needsSetup := !h.cfg.IsSetupCompleted || count == 0

	var tokenRequired bool
	if needsSetup {
		_ = h.getOrGenerateSetupToken()
		tokenRequired = true
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"is_setup_required":    needsSetup,
		"setup_token_required": tokenRequired,
		"domain":               h.cfg.MailDomain,
		"hostname":             h.cfg.MailHostname,
		"user_count":           count,
	})
}

type VerifyTokenRequest struct {
	Token string `json:"token"`
}

func (h *SetupHandlers) VerifySetupToken(w http.ResponseWriter, r *http.Request) {
	var req VerifyTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	expected := h.getOrGenerateSetupToken()
	reqToken := strings.TrimSpace(req.Token)
	if subtle.ConstantTimeCompare([]byte(reqToken), []byte(expected)) != 1 {
		http.Error(w, "Invalid setup token", http.StatusForbidden)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"valid": true})
}

type ResetSetupRequest struct {
	SetupToken string `json:"setup_token"`
}

func (h *SetupHandlers) ResetSetup(w http.ResponseWriter, r *http.Request) {
	var req ResetSetupRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	currentUser := getUserFromContext(r)
	tokenValid := false
	if req.SetupToken != "" {
		expected := h.getOrGenerateSetupToken()
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(req.SetupToken)), []byte(expected)) == 1 {
			tokenValid = true
		}
	}

	if currentUser == nil && !tokenValid {
		http.Error(w, "Unauthorized: setup token or admin session required to reset setup", http.StatusUnauthorized)
		return
	}

	h.cfg.IsSetupCompleted = false
	_ = h.cfg.Save()
	h.clearSetupToken()
	newToken := h.getOrGenerateSetupToken()

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Setup wizard has been reset. A new security token has been generated.",
		"token":   newToken,
	})
}

type InitSetupRequest struct {
	SetupToken    string `json:"setup_token"`
	AdminEmail    string `json:"admin_email"`
	AdminPassword string `json:"admin_password"`
	DisplayName   string `json:"display_name"`
	MailDomain    string `json:"mail_domain"`
	MailHostname  string `json:"mail_hostname"`
}

func (h *SetupHandlers) InitializeSetup(w http.ResponseWriter, r *http.Request) {
	var req InitSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Verify setup security token to prevent hijacking
	expectedToken := h.getOrGenerateSetupToken()
	reqToken := strings.TrimSpace(req.SetupToken)
	if subtle.ConstantTimeCompare([]byte(reqToken), []byte(expectedToken)) != 1 {
		http.Error(w, "Invalid or missing setup security token. Please check your container logs or /data/setup_token.", http.StatusForbidden)
		return
	}

	req.AdminEmail = strings.TrimSpace(req.AdminEmail)
	req.MailDomain = strings.TrimSpace(req.MailDomain)
	if req.AdminEmail == "" || req.AdminPassword == "" || req.MailDomain == "" {
		http.Error(w, "Admin email, password, and mail domain are required", http.StatusBadRequest)
		return
	}

	if req.MailHostname == "" {
		req.MailHostname = "mail." + req.MailDomain
	}
	if req.DisplayName == "" {
		req.DisplayName = "Administrator"
	}

	// Update configuration
	h.cfg.MailDomain = req.MailDomain
	h.cfg.MailHostname = req.MailHostname
	h.cfg.AdminEmail = req.AdminEmail
	h.cfg.AdminPassword = req.AdminPassword
	h.cfg.IsSetupCompleted = true
	_ = h.cfg.Save()

	// Invalidate setup token now that setup is complete
	h.clearSetupToken()

	// Create or ensure admin account
	user, err := h.store.EnsureUser(req.AdminEmail, req.AdminPassword, req.DisplayName)
	if err != nil {
		http.Error(w, "Failed to create admin user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Always grant administrator rights to the designated setup admin account
	_ = h.store.SetUserAdmin(user.ID, true)
	user.IsAdmin = true

	// Ensure dedicated postmaster mailbox exists when MailDomain is configured
	if req.MailDomain != "" && req.MailDomain != "localhost" {
		postmasterEmail := "postmaster@" + req.MailDomain
		if strings.ToLower(req.AdminEmail) != strings.ToLower(postmasterEmail) {
			_, _ = h.store.EnsureUser(postmasterEmail, req.AdminPassword, "Postmaster System")
		}
	}

	// Purge and merge any legacy duplicate postmaster@localhost
	_ = h.store.ResegmentUserMailboxes(req.MailDomain, req.AdminEmail)

	// Update DKIM if domain changed
	if h.dkimMgr != nil {
		h.dkimMgr.Domain = req.MailDomain
	}

	// Auto-create session token for instant login
	token := h.authMgr.CreateSession(user)
	http.SetCookie(w, &http.Cookie{
		Name:     "micromail_session",
		Value:    token,
		Path:     "/",
		Expires:  h.authMgr.GetSessionExpiry(token),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"token":   token,
		"user":    user,
		"domain":  h.cfg.MailDomain,
	})
}

// Admin Accounts Management Handlers
func (h *SetupHandlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.store.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

type CreateUserRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (h *SetupHandlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if !strings.Contains(req.Email, "@") {
		req.Email = req.Email + "@" + h.cfg.MailDomain
	}

	user, err := h.store.CreateUser(req.Email, req.Password, req.DisplayName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *SetupHandlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	currentUser := getUserFromContext(r)
	if currentUser != nil && currentUser.ID == userID {
		http.Error(w, "Cannot delete your own admin account", http.StatusBadRequest)
		return
	}

	if err := h.store.DeleteUser(userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type UpdatePasswordRequest struct {
	Password string `json:"password"`
}

func (h *SetupHandlers) UpdateUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	var req UpdatePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if err := h.store.UpdateUserPassword(userID, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *SetupHandlers) SwitchUser(w http.ResponseWriter, r *http.Request) {
	targetUserID := r.PathValue("id")
	targetUser, err := h.store.GetUserByID(targetUserID)
	if err != nil || targetUser == nil {
		http.Error(w, "Target mailbox not found", http.StatusNotFound)
		return
	}

	token := h.authMgr.CreateSession(targetUser)
	http.SetCookie(w, &http.Cookie{
		Name:     "micromail_session",
		Value:    token,
		Path:     "/",
		Expires:  h.authMgr.GetSessionExpiry(token),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"token":   token,
		"user":    targetUser,
	})
}

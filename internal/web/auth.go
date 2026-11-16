package web

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"micromail/internal/config"
	"micromail/internal/store"
)

type contextKey string

const (
	userContextKey         = contextKey("user")
	sessionTokenContextKey = contextKey("session_token")
)

func getSessionTokenFromContext(r *http.Request) string {
	if tok, ok := r.Context().Value(sessionTokenContextKey).(string); ok {
		return tok
	}
	return ""
}

type AuthManager struct {
	cfg           *config.Config
	store         *store.Store
	sessions      map[string]*SessionEntry
	rateLimiter   *RateLimiter
	tokenSettings store.TokenSettings
	mu            sync.RWMutex
}

func (a *AuthManager) SetConfig(cfg *config.Config) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cfg = cfg
}

type SessionEntry struct {
	ID         string     `json:"id"`
	User       *store.User `json:"-"`
	CreatedAt  time.Time  `json:"created_at"`
	LastActive time.Time  `json:"last_active"`
	ExpiresAt  time.Time  `json:"expires_at"`
	UserAgent  string     `json:"user_agent"`
	IP         string     `json:"ip"`
	Device     string     `json:"device"`
}

type RateLimiter struct {
	attempts map[string][]time.Time
	mu       sync.Mutex
}

func newRateLimiter() *RateLimiter {
	return &RateLimiter{
		attempts: make(map[string][]time.Time),
	}
}

func (rl *RateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-1 * time.Minute)

	// Clean older attempts
	var recent []time.Time
	for _, t := range rl.attempts[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}

	if len(recent) >= 5 {
		rl.attempts[key] = recent
		return false
	}

	recent = append(recent, now)
	rl.attempts[key] = recent
	return true
}

func NewAuthManager(s *store.Store) *AuthManager {
	ts, err := s.GetTokenSettings()
	if err != nil {
		ts = store.DefaultTokenSettings()
	}
	return &AuthManager{
		store:         s,
		sessions:      make(map[string]*SessionEntry),
		rateLimiter:   newRateLimiter(),
		tokenSettings: ts,
	}
}

func formatDeviceName(ua string) string {
	if ua == "" {
		return "Web Browser (Unknown)"
	}
	var os, browser string
	// OS detection
	if strings.Contains(ua, "Windows") {
		os = "Windows"
	} else if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS") {
		os = "macOS"
	} else if strings.Contains(ua, "Android") {
		os = "Android"
	} else if strings.Contains(ua, "iPhone") {
		os = "iPhone"
	} else if strings.Contains(ua, "iPad") {
		os = "iPad"
	} else if strings.Contains(ua, "Linux") {
		os = "Linux"
	} else {
		os = "Device"
	}

	// Browser detection
	if strings.Contains(ua, "Edg/") {
		browser = "Edge"
	} else if strings.Contains(ua, "Chrome/") {
		browser = "Chrome"
	} else if strings.Contains(ua, "Firefox/") {
		browser = "Firefox"
	} else if strings.Contains(ua, "Safari/") && !strings.Contains(ua, "Chrome") {
		browser = "Safari"
	} else {
		browser = "Web Browser"
	}

	return fmt.Sprintf("%s (%s)", browser, os)
}

func (a *AuthManager) CreateSession(user *store.User) string {
	return a.CreateSessionWithReq(user, nil)
}

func (a *AuthManager) CreateSessionWithReq(user *store.User, r *http.Request) string {
	a.mu.Lock()
	defer a.mu.Unlock()

	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	idBytes := make([]byte, 8)
	_, _ = rand.Read(idBytes)
	sessionID := "sess_" + hex.EncodeToString(idBytes)

	now := time.Now()
	duration := time.Duration(a.tokenSettings.SessionLifetimeMinutes) * time.Minute
	if duration <= 0 {
		duration = 7 * 24 * time.Hour
	}
	expiresAt := now.Add(duration)

	var ua, ip string
	if r != nil {
		ua = r.UserAgent()
		ip = r.Header.Get("X-Forwarded-For")
		if ip != "" {
			parts := strings.Split(ip, ",")
			ip = strings.TrimSpace(parts[0])
		}
		if ip == "" {
			ip = r.Header.Get("X-Real-IP")
		}
		if ip == "" {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err == nil {
				ip = host
			} else {
				ip = r.RemoteAddr
			}
		}
	}
	if ip == "" {
		ip = "127.0.0.1"
	}
	device := formatDeviceName(ua)

	// Prune oldest session if max concurrent sessions exceeded
	if a.tokenSettings.MaxConcurrentSessions > 0 {
		var userTokens []string
		for tok, entry := range a.sessions {
			if entry.User != nil && entry.User.ID == user.ID {
				userTokens = append(userTokens, tok)
			}
		}
		if len(userTokens) >= a.tokenSettings.MaxConcurrentSessions {
			var oldestTok string
			var oldestTime time.Time
			for _, tok := range userTokens {
				e := a.sessions[tok]
				if oldestTok == "" || e.LastActive.Before(oldestTime) {
					oldestTok = tok
					oldestTime = e.LastActive
				}
			}
			if oldestTok != "" {
				delete(a.sessions, oldestTok)
			}
		}
	}

	a.sessions[token] = &SessionEntry{
		ID:         sessionID,
		User:       user,
		CreatedAt:  now,
		LastActive: now,
		ExpiresAt:  expiresAt,
		UserAgent:  ua,
		IP:         ip,
		Device:     device,
	}
	return token
}

func (a *AuthManager) GetSessionExpiry(token string) time.Time {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if entry, ok := a.sessions[token]; ok {
		return entry.ExpiresAt
	}
	return time.Now().Add(7 * 24 * time.Hour)
}

func (a *AuthManager) GetUser(token string) *store.User {
	a.mu.Lock()
	defer a.mu.Unlock()

	entry, ok := a.sessions[token]
	if !ok {
		return nil
	}
	now := time.Now()
	if now.After(entry.ExpiresAt) {
		delete(a.sessions, token)
		return nil
	}

	entry.LastActive = now
	if entry.ID == "" {
		idBytes := make([]byte, 8)
		_, _ = rand.Read(idBytes)
		entry.ID = "sess_" + hex.EncodeToString(idBytes)
	}
	if entry.Device == "" {
		entry.Device = formatDeviceName(entry.UserAgent)
	}

	// Sliding expiration renewal
	if a.tokenSettings.SlidingExpiration {
		duration := time.Duration(a.tokenSettings.SessionLifetimeMinutes) * time.Minute
		if duration > 0 {
			maxLifetime := time.Duration(a.tokenSettings.RefreshTokenExpiryDays) * 24 * time.Hour
			if maxLifetime <= 0 {
				maxLifetime = 30 * 24 * time.Hour
			}
			hardDeadline := entry.CreatedAt.Add(maxLifetime)
			proposed := now.Add(duration)
			if proposed.After(hardDeadline) {
				proposed = hardDeadline
			}
			if proposed.After(entry.ExpiresAt) {
				entry.ExpiresAt = proposed
			}
		}
	}

	return entry.User
}

func (a *AuthManager) DeleteSession(token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.sessions, token)
}

func (a *AuthManager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var token string

		// Check Authorization: Bearer <token>
		authHeader := r.Header.Get("Authorization")
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token = authHeader[7:]
		}

		// Fallback to cookie
		if token == "" {
			if cookie, err := r.Cookie("micromail_session"); err == nil {
				token = cookie.Value
			}
		}

		// Check query param for SSE / token
		if token == "" {
			token = r.URL.Query().Get("token")
		}

		if token != "" {
			if user := a.GetUser(token); user != nil {
				ctx := context.WithValue(r.Context(), userContextKey, user)
				ctx = context.WithValue(ctx, sessionTokenContextKey, token)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func (a *AuthManager) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := getUserFromContext(r)
		if user == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Code     string `json:"code,omitempty"` // 6-digit TOTP or backup recovery code
}

func (a *AuthManager) LoginHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Brute-force rate limiting by Client IP
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}

	if !a.rateLimiter.allow(ip) {
		http.Error(w, "Too many login attempts. Please wait 1 minute before trying again.", http.StatusTooManyRequests)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := a.store.AuthenticateUser(req.Email, req.Password)
	if err != nil {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	// 2. Check Two-Factor Authentication (2FA)
	if user.TOTPEnabled {
		if req.Code == "" {
			// Notify client that 2FA code is required
			writeJSON(w, http.StatusOK, map[string]any{
				"requires_2fa": true,
				"email":        user.Email,
			})
			return
		}

		// Validate 6-digit code or single-use recovery code
		cleanCode := strings.TrimSpace(req.Code)
		isValid := false

		if len(cleanCode) == 6 && ValidateTOTP(user.TOTPSecret, cleanCode) {
			isValid = true
		} else {
			// Check recovery code
			consumed, err := a.store.ValidateAndConsumeRecoveryCode(user.ID, cleanCode)
			if err == nil && consumed {
				isValid = true
			}
		}

		if !isValid {
			http.Error(w, "Invalid two-factor authentication code", http.StatusUnauthorized)
			return
		}
	}

	token := a.CreateSessionWithReq(user, r)
	expiresAt := a.GetSessionExpiry(token)

	http.SetCookie(w, &http.Cookie{
		Name:     "micromail_session",
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"user":       user,
		"expires_at": expiresAt.Unix(),
	})
}

func (a *AuthManager) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("micromail_session"); err == nil {
		a.DeleteSession(cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "micromail_session",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
	})

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *AuthManager) MeHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Always refresh latest user profile (display name, signature, admin state) from store
	if dbUser, err := a.store.GetUserByID(user.ID); err == nil && dbUser != nil {
		user.DisplayName = dbUser.DisplayName
		user.Signature = dbUser.Signature
		user.IsAdmin = dbUser.IsAdmin
		user.TOTPEnabled = dbUser.TOTPEnabled
	}

	writeJSON(w, http.StatusOK, user)
}

type UserSettingsResponse struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	Signature    string `json:"signature"`
	IsAdmin      bool   `json:"is_admin"`
	TOTPEnabled  bool   `json:"totp_enabled"`
	MailDomain   string `json:"mail_domain,omitempty"`
	MailHostname string `json:"mail_hostname,omitempty"`
}

type UpdateUserSettingsRequest struct {
	DisplayName string `json:"display_name"`
	Signature   string `json:"signature"`
}

func (a *AuthManager) GetUserSettingsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	dbUser, err := a.store.GetUserByID(user.ID)
	if err != nil {
		http.Error(w, "Failed to load user settings: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.mu.RLock()
	var mailDomain, mailHostname string
	if a.cfg != nil {
		mailDomain = a.cfg.MailDomain
		mailHostname = a.cfg.MailHostname
	}
	a.mu.RUnlock()

	writeJSON(w, http.StatusOK, UserSettingsResponse{
		ID:           dbUser.ID,
		Email:        dbUser.Email,
		DisplayName:  dbUser.DisplayName,
		Signature:    dbUser.Signature,
		IsAdmin:      dbUser.IsAdmin,
		TOTPEnabled:  dbUser.TOTPEnabled,
		MailDomain:   mailDomain,
		MailHostname: mailHostname,
	})
}

func (a *AuthManager) UpdateUserSettingsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req UpdateUserSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = strings.Split(user.Email, "@")[0]
	}

	if err := a.store.UpdateUserSettings(user.ID, displayName, req.Signature); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Update cached user in session
	user.DisplayName = displayName
	user.Signature = req.Signature

	writeJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"display_name": displayName,
		"signature":    req.Signature,
	})
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (a *AuthManager) ChangePasswordHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) < 6 {
		http.Error(w, "New password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	if err := a.store.VerifyAndChangeUserPassword(user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// 2FA Management Endpoints

func (a *AuthManager) Setup2FAHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	secret := GenerateTOTPSecret()
	recoveryCodes := GenerateRecoveryCodes(5)
	otpauthURI := BuildOTPAuthURI(user.Email, "MicroMail", secret)

	writeJSON(w, http.StatusOK, map[string]any{
		"secret":         secret,
		"otpauth_uri":    otpauthURI,
		"recovery_codes": recoveryCodes,
	})
}

type Enable2FARequest struct {
	Secret        string   `json:"secret"`
	Code          string   `json:"code"`
	RecoveryCodes []string `json:"recovery_codes"`
}

func (a *AuthManager) Enable2FAHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req Enable2FARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Verify the user was able to generate a valid code
	if !ValidateTOTP(req.Secret, req.Code) {
		http.Error(w, "Invalid verification code. Check your authenticator app time sync.", http.StatusBadRequest)
		return
	}

	recCodesJSON, _ := json.Marshal(req.RecoveryCodes)
	if err := a.store.EnableUserTOTP(user.ID, req.Secret, string(recCodesJSON)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user.TOTPEnabled = true
	user.TOTPSecret = req.Secret

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type Disable2FARequest struct {
	Password string `json:"password"`
}

func (a *AuthManager) Disable2FAHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req Disable2FARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Verify master password before disabling 2FA
	dbUser, err := a.store.GetUserByID(user.ID)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(dbUser.PasswordHash), []byte(req.Password)) != nil {
		http.Error(w, "Incorrect password", http.StatusUnauthorized)
		return
	}

	if err := a.store.DisableUserTOTP(user.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user.TOTPEnabled = false
	user.TOTPSecret = ""

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *AuthManager) Status2FAHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	dbUser, err := a.store.GetUserByID(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"totp_enabled": dbUser.TOTPEnabled,
		"email":        dbUser.Email,
	})
}

// Token & Session Configuration Handlers

func (a *AuthManager) GetTokenSettingsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	a.mu.RLock()
	ts := a.tokenSettings
	activeCount := len(a.sessions)
	a.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"settings":        ts,
		"active_sessions": activeCount,
	})
}

type UpdateTokenSettingsRequest struct {
	SessionLifetimeMinutes int  `json:"session_lifetime_minutes"`
	RefreshTokenExpiryDays int  `json:"refresh_token_expiry_days"`
	SlidingExpiration      bool `json:"sliding_expiration"`
	MaxConcurrentSessions  int  `json:"max_concurrent_sessions"`
	RevokeOtherSessions    bool `json:"revoke_other_sessions,omitempty"`
}

func (a *AuthManager) UpdateTokenSettingsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req UpdateTokenSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.SessionLifetimeMinutes < 5 {
		http.Error(w, "Session lifetime must be at least 5 minutes", http.StatusBadRequest)
		return
	}
	if req.RefreshTokenExpiryDays < 1 {
		req.RefreshTokenExpiryDays = 1
	}

	ts := store.TokenSettings{
		SessionLifetimeMinutes: req.SessionLifetimeMinutes,
		RefreshTokenExpiryDays: req.RefreshTokenExpiryDays,
		SlidingExpiration:      req.SlidingExpiration,
		MaxConcurrentSessions:  req.MaxConcurrentSessions,
	}

	if err := a.store.SaveTokenSettings(ts); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	a.mu.Lock()
	a.tokenSettings = ts
	revokedCount := 0
	if req.RevokeOtherSessions {
		currentToken := r.Header.Get("Authorization")
		if strings.HasPrefix(currentToken, "Bearer ") {
			currentToken = strings.TrimPrefix(currentToken, "Bearer ")
		}
		if currentToken == "" {
			if cookie, err := r.Cookie("micromail_session"); err == nil {
				currentToken = cookie.Value
			}
		}
		for tok := range a.sessions {
			if tok != currentToken {
				delete(a.sessions, tok)
				revokedCount++
			}
		}
	}
	a.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"success":          true,
		"settings":         ts,
		"revoked_sessions": revokedCount,
	})
}

func (a *AuthManager) RevokeAllSessionsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	currentToken := r.Header.Get("Authorization")
	if strings.HasPrefix(currentToken, "Bearer ") {
		currentToken = strings.TrimPrefix(currentToken, "Bearer ")
	}
	if currentToken == "" {
		if cookie, err := r.Cookie("micromail_session"); err == nil {
			currentToken = cookie.Value
		}
	}

	a.mu.Lock()
	count := 0
	for tok := range a.sessions {
		if tok != currentToken {
			delete(a.sessions, tok)
			count++
		}
	}
	a.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"revoked_count": count,
	})
}

type UserSessionDTO struct {
	ID         string `json:"id"`
	Device     string `json:"device"`
	UserAgent  string `json:"user_agent"`
	IP         string `json:"ip"`
	Current    bool   `json:"current"`
	CreatedAt  int64  `json:"created_at"`
	LastActive int64  `json:"last_active"`
	ExpiresAt  int64  `json:"expires_at"`
}

func (a *AuthManager) ListUserSessionsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	currentTok := getSessionTokenFromContext(r)

	a.mu.RLock()
	var list []UserSessionDTO
	now := time.Now()
	for tok, entry := range a.sessions {
		if entry.User != nil && entry.User.ID == user.ID && now.Before(entry.ExpiresAt) {
			list = append(list, UserSessionDTO{
				ID:         entry.ID,
				Device:     entry.Device,
				UserAgent:  entry.UserAgent,
				IP:         entry.IP,
				Current:    (tok == currentTok),
				CreatedAt:  entry.CreatedAt.Unix(),
				LastActive: entry.LastActive.Unix(),
				ExpiresAt:  entry.ExpiresAt.Unix(),
			})
		}
	}
	a.mu.RUnlock()

	sort.Slice(list, func(i, j int) bool {
		if list[i].Current {
			return true
		}
		if list[j].Current {
			return false
		}
		return list[i].LastActive > list[j].LastActive
	})

	if list == nil {
		list = make([]UserSessionDTO, 0)
	}

	writeJSON(w, http.StatusOK, list)
}

type RevokeUserSessionRequest struct {
	SessionID string `json:"session_id"`
}

func (a *AuthManager) RevokeUserSessionHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	currentTok := getSessionTokenFromContext(r)

	var req RevokeUserSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	a.mu.Lock()
	var revokedToken string
	for tok, entry := range a.sessions {
		if entry.User != nil && entry.User.ID == user.ID && entry.ID == req.SessionID {
			revokedToken = tok
			delete(a.sessions, tok)
			break
		}
	}
	a.mu.Unlock()

	if revokedToken == "" {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if revokedToken == currentTok {
		http.SetCookie(w, &http.Cookie{
			Name:     "micromail_session",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			Expires:  time.Unix(0, 0),
			HttpOnly: true,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "is_current": revokedToken == currentTok})
}

func (a *AuthManager) RevokeOtherUserSessionsHandler(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	currentTok := getSessionTokenFromContext(r)

	a.mu.Lock()
	count := 0
	for tok, entry := range a.sessions {
		if entry.User != nil && entry.User.ID == user.ID && tok != currentTok {
			delete(a.sessions, tok)
			count++
		}
	}
	a.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "revoked_count": count})
}

func getUserFromContext(r *http.Request) *store.User {
	val := r.Context().Value(userContextKey)
	if val == nil {
		return nil
	}
	user, ok := val.(*store.User)
	if !ok {
		return nil
	}
	return user
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

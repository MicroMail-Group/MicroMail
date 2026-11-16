package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

type TokenSettings struct {
	SessionLifetimeMinutes int   `json:"session_lifetime_minutes"`
	RefreshTokenExpiryDays int   `json:"refresh_token_expiry_days"`
	SlidingExpiration      bool  `json:"sliding_expiration"`
	MaxConcurrentSessions  int   `json:"max_concurrent_sessions"`
	UpdatedAt              int64 `json:"updated_at"`
}

func DefaultTokenSettings() TokenSettings {
	return TokenSettings{
		SessionLifetimeMinutes: 10080, // 7 days default
		RefreshTokenExpiryDays: 30,    // 30 days default
		SlidingExpiration:      true,
		MaxConcurrentSessions:  5,
		UpdatedAt:              time.Now().Unix(),
	}
}

func (s *Store) GetTokenSettings() (TokenSettings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var val string
	err := s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'token_settings'`).Scan(&val)
	if err == sql.ErrNoRows {
		return DefaultTokenSettings(), nil
	}
	if err != nil {
		return DefaultTokenSettings(), err
	}

	var ts TokenSettings
	if err := json.Unmarshal([]byte(val), &ts); err != nil {
		return DefaultTokenSettings(), nil
	}
	if ts.SessionLifetimeMinutes <= 0 {
		ts.SessionLifetimeMinutes = 10080
	}
	if ts.RefreshTokenExpiryDays <= 0 {
		ts.RefreshTokenExpiryDays = 30
	}
	return ts, nil
}

func (s *Store) SaveTokenSettings(ts TokenSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ts.UpdatedAt = time.Now().Unix()
	data, err := json.Marshal(ts)
	if err != nil {
		return err
	}

	_, err = s.db.Exec(`
		INSERT INTO system_settings (key, value, updated_at)
		VALUES ('token_settings', ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
	`, string(data), ts.UpdatedAt)
	return err
}

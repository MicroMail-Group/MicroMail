package store

import (
	"database/sql"
	"time"
)

type InstalledAddon struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Version      string `json:"version"`
	Runtime      string `json:"runtime"` // "frontend", "backend", "hybrid"
	ManifestJSON string `json:"manifest_json"`
	ConfigJSON   string `json:"config_json"`
	Enabled      bool   `json:"enabled"`
	InstalledAt  int64  `json:"installed_at"`
}

func (s *Store) SaveAddon(a *InstalledAddon) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if a.InstalledAt == 0 {
		a.InstalledAt = time.Now().Unix()
	}

	enabledInt := 0
	if a.Enabled {
		enabledInt = 1
	}

	_, err := s.db.Exec(`
		INSERT INTO addons (id, name, version, runtime, manifest_json, config_json, enabled, installed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			version = excluded.version,
			runtime = excluded.runtime,
			manifest_json = excluded.manifest_json,
			config_json = excluded.config_json,
			enabled = excluded.enabled
	`, a.ID, a.Name, a.Version, a.Runtime, a.ManifestJSON, a.ConfigJSON, enabledInt, a.InstalledAt)

	return err
}

func (s *Store) GetAddon(id string) (*InstalledAddon, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, name, version, runtime, manifest_json, config_json, enabled, installed_at
		FROM addons WHERE id = ?
	`, id)

	var a InstalledAddon
	var enabledInt int
	err := row.Scan(&a.ID, &a.Name, &a.Version, &a.Runtime, &a.ManifestJSON, &a.ConfigJSON, &enabledInt, &a.InstalledAt)
	if err != nil {
		return nil, err
	}
	a.Enabled = enabledInt == 1
	return &a, nil
}

func (s *Store) ListAddons() ([]*InstalledAddon, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, name, version, runtime, manifest_json, config_json, enabled, installed_at
		FROM addons ORDER BY installed_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*InstalledAddon
	for rows.Next() {
		var a InstalledAddon
		var enabledInt int
		if err := rows.Scan(&a.ID, &a.Name, &a.Version, &a.Runtime, &a.ManifestJSON, &a.ConfigJSON, &enabledInt, &a.InstalledAt); err != nil {
			return nil, err
		}
		a.Enabled = enabledInt == 1
		result = append(result, &a)
	}
	return result, nil
}

func (s *Store) ListEnabledAddons() ([]*InstalledAddon, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, name, version, runtime, manifest_json, config_json, enabled, installed_at
		FROM addons WHERE enabled = 1 ORDER BY installed_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*InstalledAddon
	for rows.Next() {
		var a InstalledAddon
		var enabledInt int
		if err := rows.Scan(&a.ID, &a.Name, &a.Version, &a.Runtime, &a.ManifestJSON, &a.ConfigJSON, &enabledInt, &a.InstalledAt); err != nil {
			return nil, err
		}
		a.Enabled = true
		result = append(result, &a)
	}
	return result, nil
}

func (s *Store) SetAddonEnabled(id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	val := 0
	if enabled {
		val = 1
	}
	_, err := s.db.Exec(`UPDATE addons SET enabled = ? WHERE id = ?`, val, id)
	return err
}

func (s *Store) UpdateAddonConfig(id string, configJSON string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`UPDATE addons SET config_json = ? WHERE id = ?`, configJSON, id)
	return err
}

func (s *Store) DeleteAddon(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	res, err := s.db.Exec(`DELETE FROM addons WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

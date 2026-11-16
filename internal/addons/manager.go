package addons

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"micromail/internal/store"
)

type Manager struct {
	dataDir     string
	registryURL string
	store       *store.Store
	wasmRunner  *WASMRunner
	mu          sync.RWMutex
}

func NewManager(dataDir, registryURL string, s *store.Store, runner *WASMRunner) *Manager {
	return &Manager{
		dataDir:     dataDir,
		registryURL: registryURL,
		store:       s,
		wasmRunner:  runner,
	}
}

func (m *Manager) FetchRegistry() (*RegistryCatalog, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(m.registryURL)
	if err != nil {
		return &RegistryCatalog{Addons: []RegistryItem{}}, fmt.Errorf("failed to reach addon registry: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &RegistryCatalog{Addons: []RegistryItem{}}, fmt.Errorf("addon registry returned status %d", resp.StatusCode)
	}

	var catalog RegistryCatalog
	if err := json.NewDecoder(resp.Body).Decode(&catalog); err != nil {
		return &RegistryCatalog{Addons: []RegistryItem{}}, fmt.Errorf("failed to decode registry catalog: %w", err)
	}

	if catalog.Addons == nil {
		catalog.Addons = []RegistryItem{}
	}
	return &catalog, nil
}

func (m *Manager) InstallFromZipBytes(zipData []byte, expectedSHA256 string) (*Manifest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if expectedSHA256 != "" {
		hash := sha256.Sum256(zipData)
		actualSHA := hex.EncodeToString(hash[:])
		if !strings.EqualFold(actualSHA, expectedSHA256) {
			return nil, fmt.Errorf("sha256 mismatch: expected %s, got %s", expectedSHA256, actualSHA)
		}
	}

	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("invalid zip archive: %w", err)
	}

	// First pass: locate and parse addon.json
	var manifestData []byte
	for _, f := range zr.File {
		cleanName := filepath.Clean(f.Name)
		if cleanName == "addon.json" || strings.HasSuffix(cleanName, "/addon.json") || strings.HasSuffix(cleanName, "\\addon.json") {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			manifestData, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return nil, err
			}
			break
		}
	}

	if len(manifestData) == 0 {
		return nil, fmt.Errorf("addon.json not found in zip archive")
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("invalid addon.json: %w", err)
	}

	if manifest.ID == "" || manifest.Name == "" {
		return nil, fmt.Errorf("addon.json must specify id and name")
	}

	targetDir := filepath.Join(m.dataDir, "addons", manifest.ID)
	// Clean target directory if previously exists
	_ = os.RemoveAll(targetDir)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create addon target directory: %w", err)
	}

	// Extract files with zip-slip protection
	for _, f := range zr.File {
		cleanPath := filepath.Clean(f.Name)
		// Check for directory traversal
		if strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, "../") || strings.Contains(cleanPath, "..\\") {
			continue // skip dangerous path
		}

		destPath := filepath.Join(targetDir, cleanPath)
		if !strings.HasPrefix(destPath, filepath.Clean(targetDir)) {
			return nil, fmt.Errorf("illegal file path in zip: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(destPath, 0755)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return nil, err
		}

		rc, err := f.Open()
		if err != nil {
			return nil, err
		}

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return nil, err
		}

		_, cpErr := io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if cpErr != nil {
			return nil, cpErr
		}
	}

	// Extract default config JSON from config_schema
	defaultConfig := make(map[string]any)
	for _, item := range manifest.ConfigSchema {
		if item.Default != nil {
			defaultConfig[item.Key] = item.Default
		}
	}
	configBytes, _ := json.Marshal(defaultConfig)

	// Save to database
	installed := &store.InstalledAddon{
		ID:           manifest.ID,
		Name:         manifest.Name,
		Version:      manifest.Version,
		Runtime:      manifest.Runtime,
		ManifestJSON: string(manifestData),
		ConfigJSON:   string(configBytes),
		Enabled:      true,
		InstalledAt:  time.Now().Unix(),
	}

	if err := m.store.SaveAddon(installed); err != nil {
		return nil, fmt.Errorf("failed to save addon to store: %w", err)
	}

	// If backend addon, precompile into wasm runner
	if manifest.Backend != nil && manifest.Backend.Wasm != "" && m.wasmRunner != nil {
		wasmPath := filepath.Join(targetDir, manifest.Backend.Wasm)
		_ = m.wasmRunner.CompileModule(manifest.ID, manifest.Version, wasmPath)
	}

	return &manifest, nil
}

func (m *Manager) Uninstall(addonID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.wasmRunner != nil {
		m.wasmRunner.RemoveModule(addonID)
	}

	targetDir := filepath.Join(m.dataDir, "addons", addonID)
	_ = os.RemoveAll(targetDir)

	return m.store.DeleteAddon(addonID)
}

func (m *Manager) ToggleEnabled(addonID string, enabled bool) error {
	return m.store.SetAddonEnabled(addonID, enabled)
}

func (m *Manager) UpdateConfig(addonID string, configJSON string) error {
	return m.store.UpdateAddonConfig(addonID, configJSON)
}

func (m *Manager) GetAddonPath(addonID string) string {
	return filepath.Join(m.dataDir, "addons", addonID)
}

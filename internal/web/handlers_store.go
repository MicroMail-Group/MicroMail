package web

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"micromail/internal/addons"
	"micromail/internal/store"
)

type StoreHandlers struct {
	manager    *addons.Manager
	store      *store.Store
	wasmRunner *addons.WASMRunner
}

func NewStoreHandlers(mgr *addons.Manager, s *store.Store, runner *addons.WASMRunner) *StoreHandlers {
	return &StoreHandlers{
		manager:    mgr,
		store:      s,
		wasmRunner: runner,
	}
}

func (h *StoreHandlers) GetCatalog(w http.ResponseWriter, r *http.Request) {
	catalog, err := h.manager.FetchRegistry()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (h *StoreHandlers) ListInstalled(w http.ResponseWriter, r *http.Request) {
	addonsList, err := h.store.ListAddons()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, addonsList)
}

type EnabledAddonDTO struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Version      string           `json:"version"`
	Runtime      string           `json:"runtime"`
	Manifest     *addons.Manifest `json:"manifest"`
	Config       map[string]any   `json:"config"`
	ConfigSchema []addons.ConfigSchemaItem `json:"config_schema,omitempty"`
}

func (h *StoreHandlers) ListEnabled(w http.ResponseWriter, r *http.Request) {
	enabled, err := h.store.ListEnabledAddons()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var dtos []EnabledAddonDTO
	for _, a := range enabled {
		var mf addons.Manifest
		_ = json.Unmarshal([]byte(a.ManifestJSON), &mf)

		var cfg map[string]any
		_ = json.Unmarshal([]byte(a.ConfigJSON), &cfg)
		if cfg == nil {
			cfg = make(map[string]any)
		}

		dtos = append(dtos, EnabledAddonDTO{
			ID:           a.ID,
			Name:         a.Name,
			Version:      a.Version,
			Runtime:      a.Runtime,
			Manifest:     &mf,
			Config:       cfg,
			ConfigSchema: mf.ConfigSchema,
		})
	}

	writeJSON(w, http.StatusOK, dtos)
}

type InstallRequest struct {
	ID          string `json:"id"`
	DownloadURL string `json:"download_url"`
	SHA256      string `json:"sha256"`
}

func (h *StoreHandlers) InstallAddon(w http.ResponseWriter, r *http.Request) {
	// Support both multipart file upload and JSON download_url
	var zipBytes []byte
	var expectedSHA string

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		file, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Error reading file upload: "+err.Error(), http.StatusBadRequest)
			return
		}
		defer file.Close()
		zipBytes, _ = io.ReadAll(file)
	} else {
		var req InstallRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		expectedSHA = req.SHA256

		if req.DownloadURL == "" {
			http.Error(w, "Download URL is required", http.StatusBadRequest)
			return
		}

		// Remote download from URL
		resp, err := http.Get(req.DownloadURL)
		if err != nil || resp.StatusCode != http.StatusOK {
			http.Error(w, "Failed to download addon zip from remote source", http.StatusBadRequest)
			return
		}
		defer resp.Body.Close()
		zipBytes, _ = io.ReadAll(resp.Body)
	}

	manifest, err := h.manager.InstallFromZipBytes(zipBytes, expectedSHA)
	if err != nil {
		http.Error(w, "Failed to install addon: "+err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, manifest)
}

type ToggleRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *StoreHandlers) ToggleAddon(w http.ResponseWriter, r *http.Request) {
	addonID := r.PathValue("id")
	var req ToggleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if err := h.manager.ToggleEnabled(addonID, req.Enabled); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *StoreHandlers) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	addonID := r.PathValue("id")
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read config", http.StatusBadRequest)
		return
	}

	// Validate JSON
	var js map[string]any
	if err := json.Unmarshal(bodyBytes, &js); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := h.manager.UpdateConfig(addonID, string(bodyBytes)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *StoreHandlers) UninstallAddon(w http.ResponseWriter, r *http.Request) {
	addonID := r.PathValue("id")
	if err := h.manager.Uninstall(addonID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

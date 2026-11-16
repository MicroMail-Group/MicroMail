package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	MailDomain         string `json:"mail_domain"`
	MailHostname       string `json:"mail_hostname"`
	DataDir            string `json:"data_dir"`
	HTTPAddr           string `json:"http_addr"`
	SMTPInAddr         string `json:"smtp_in_addr"`
	SMTPSubmissionAddr string `json:"smtp_submission_addr"`
	IMAPAddr           string `json:"imap_addr"`
	TLSCertFile        string `json:"tls_cert_file"`
	TLSKeyFile         string `json:"tls_key_file"`
	AddonRegistryURL   string `json:"addon_registry_url"`
	DKIMPrivateKeyPath string `json:"dkim_private_key_path"`
	DKIMSelector       string `json:"dkim_selector"`
	AdminEmail         string `json:"admin_email"`
	AdminPassword      string `json:"admin_password"`
	IsSetupCompleted   bool   `json:"is_setup_completed"`
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func LoadConfig() (*Config, error) {
	dataDir := getEnv("DATA_DIR", "/data")
	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		// Fallback to local data dir if running outside docker
		if localDir := "./data"; os.Getenv("DATA_DIR") == "" {
			dataDir = localDir
		}
	}

	cfg := &Config{
		MailDomain:         getEnv("MAIL_DOMAIN", "localhost"),
		MailHostname:       getEnv("MAIL_HOSTNAME", "mail.localhost"),
		DataDir:            dataDir,
		HTTPAddr:           getEnv("HTTP_ADDR", ":8080"),
		SMTPInAddr:         getEnv("SMTP_IN_ADDR", ":25"),
		SMTPSubmissionAddr: getEnv("SMTP_SUBMISSION_ADDR", ":587"),
		IMAPAddr:           getEnv("IMAP_ADDR", ":993"),
		TLSCertFile:        getEnv("TLS_CERT", ""),
		TLSKeyFile:         getEnv("TLS_KEY", ""),
		AddonRegistryURL:   getEnv("ADDON_REGISTRY_URL", "https://cdn.jsdelivr.net/gh/MicroMail-Group/Registry@master/registry.json"),
		DKIMSelector:       getEnv("DKIM_SELECTOR", "default"),
		AdminEmail:         getEnv("ADMIN_EMAIL", "admin@localhost"),
		AdminPassword:      getEnv("ADMIN_PASSWORD", "admin123"),
	}

	configFile := filepath.Join(cfg.DataDir, "config.json")
	if data, err := os.ReadFile(configFile); err == nil {
		_ = json.Unmarshal(data, cfg)
	}

	if cfg.DKIMPrivateKeyPath == "" {
		cfg.DKIMPrivateKeyPath = filepath.Join(cfg.DataDir, "dkim", "default.private.pem")
	}

	// Ensure required directories exist
	dirs := []string{
		cfg.DataDir,
		filepath.Join(cfg.DataDir, "dkim"),
		filepath.Join(cfg.DataDir, "blobs"),
		filepath.Join(cfg.DataDir, "addons"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, err
		}
	}

	return cfg, nil
}

func (c *Config) Save() error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	configFile := filepath.Join(c.DataDir, "config.json")
	return os.WriteFile(configFile, data, 0644)
}

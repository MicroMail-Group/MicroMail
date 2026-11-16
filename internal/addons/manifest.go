package addons

type ConfigSchemaItem struct {
	Key     string   `json:"key"`
	Type    string   `json:"type"` // "string", "number", "boolean", "select"
	Options []string `json:"options,omitempty"`
	Default any      `json:"default,omitempty"`
	Label   string   `json:"label"`
}

type FrontendConfig struct {
	Entry            string   `json:"entry"`
	Slots            []string `json:"slots"`
	RequiresCoopCoep bool     `json:"requires_coop_coep,omitempty"`
}

type BackendConfig struct {
	Wasm      string   `json:"wasm"`
	Hooks     []string `json:"hooks"`
	TimeoutMS int      `json:"timeout_ms,omitempty"`
}

type Manifest struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Version      string             `json:"version"`
	Runtime      string             `json:"runtime"` // "frontend", "backend", "hybrid"
	Description  string             `json:"description"`
	Permissions  []string           `json:"permissions"`
	Frontend     *FrontendConfig    `json:"frontend,omitempty"`
	Backend      *BackendConfig     `json:"backend,omitempty"`
	ConfigSchema []ConfigSchemaItem `json:"config_schema,omitempty"`
}

type RegistryItem struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	Runtime     string    `json:"runtime"`
	Description string    `json:"description"`
	DownloadURL string    `json:"download_url"`
	SHA256      string    `json:"sha256"`
	Manifest    *Manifest `json:"manifest,omitempty"`
}

type RegistryCatalog struct {
	Addons []RegistryItem `json:"addons"`
}

// Hook invocation payload types
type AttachmentData struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Path        string `json:"path"`
}

type InboundEmailData struct {
	From        string            `json:"from"`
	To          []string          `json:"to"`
	Subject     string            `json:"subject"`
	Headers     map[string]string `json:"headers"`
	BodyText    string            `json:"body_text"`
	RawBlobPath string            `json:"raw_blob_path,omitempty"`
	Attachments []AttachmentData  `json:"attachments,omitempty"`
}

type HookInput struct {
	Hook   string           `json:"hook"`
	Config map[string]any   `json:"config"`
	Email  InboundEmailData `json:"email"`
}

type HookOutput struct {
	Action    string   `json:"action"` // "accept", "spam", "reject"
	SpamScore float64  `json:"spam_score"`
	Tags      []string `json:"tags"`
}

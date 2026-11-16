<div align="center">
  <h1>MicroMail</h1>
  <img src="assets/micromail-multichromatic-gradient.png" height="256" />
</div>

A single-container, zero-sidecar email server, webmail client, and WebAssembly (WASM) addon hub built with pure Go 1.24+ and React 19.

---

## Highlights & Architectural Principles

- **Single Static Binary & Container:** Compiles with `CGO_ENABLED=0` into a single ~22 MB static binary combining SQLite (pure Go `modernc.org/sqlite`), SMTP inbound/outbound engines, IMAP4rev2 server, `wazero` WebAssembly sandbox runtime, REST/SSE API, and an embedded React 19 SPA.
- **Zero External Sidecars:** Frontend addons (browser ES modules and speech/AI `.wasm` models) and backend addons (sandboxed WASI `.wasm` modules executing in `wazero`) download as `.zip` packages into `/data/addons/` and run completely inside the single container.
- **Clean Network Separation:**
  - **Webmail & Addon Store UI (`:8080`):** Runs internally behind Cloudflare Tunnel (`cloudflared`) or a reverse proxy—zero open HTTP ports and zero internal TLS overhead.
  - **Mail Protocols (`:25`, `:587`, `:993`):** Exposed directly via Docker port forwarding on a clean static IP or WireGuard tunnel, bypassing Cloudflare HTTP proxies (`DNS Only` / grey cloud for `A` and `MX` records).
- **Auto DKIM & FTS5 Search:** Auto-generates 2048-bit RSA DKIM keys on boot, verifies SPF/DKIM on inbound, signs outbound messages, and provides full-text search indexed across subject, sender, and body text.
- **Reactive Inbox:** Uses Server-Sent Events (SSE) to push incoming emails to the web UI in real-time.
- **Rich Mail Client:** Full attachment support (uploading, MIME packaging, image previews, 1-click downloads) and an interactive multi-category emoji picker in the composer.

---

## Repository Structure

```text
MicroMail/
├── cmd/
│   └── micromail/
│       └── main.go                 # Boots Store, Addon Manager, SMTP, IMAP, and HTTP server
├── internal/
│   ├── config/
│   │   └── config.go               # Env vars & /data/config.json loader
│   ├── store/
│   │   ├── db.go                   # Pure-Go SQLite connection (WAL mode) & migration runner
│   │   ├── migrations/
│   │   │   └── 001_init.sql        # Users, folders, threads, messages, attachments, addons, FTS5
│   │   ├── messages.go             # CRUD, thread grouping, full-text search, IMAP UID management
│   │   └── addons.go               # Installed addons metadata, config JSON, enable state
│   ├── mail/
│   │   ├── dkim.go                 # 2048-bit RSA DKIM keygen & DNS TXT formatter
│   │   ├── mime.go                 # RFC 5322 MIME parser & blob storage
│   │   ├── smtp_in.go              # Inbound SMTP server: SPF/DKIM check -> WASM hooks -> SQLite -> SSE
│   │   ├── smtp_out.go             # Outbound engine: DKIM signing -> MX lookup & STARTTLS delivery
│   │   └── imap_server.go          # IMAP4rev2 server exposing SQLite folders & messages to desktop/mobile
│   ├── addons/
│   │   ├── manifest.go             # addon.json & registry structs + hook schemas
│   │   ├── manager.go              # Zip-slip safe extractor, catalog fetcher, installer
│   │   └── wasm_runner.go          # wazero WASI runtime: stdin/stdout JSON execution sandbox
│   └── web/
│       ├── auth.go                 # Session authentication & cookies
│       ├── handlers_mail.go        # Thread listing, message view, mark read, move, send, search
│       ├── handlers_store.go       # Catalog, install, toggle, configure, uninstall addons
│       ├── wasm_reference.go       # Pre-assembled WASI bytecode for reference spam filter
│       ├── router.go               # net/http routes (/api/*, /addons/*, /* SPA fallback)
│       ├── sse.go                  # Server-Sent Events broadcaster
│       └── dist/                   # Production build of React webmail UI (embedded via //go:embed)
├── web/                            # React 19 + TypeScript + Vite + Tailwind CSS source
│   ├── src/
│   │   ├── sdk/
│   │   │   ├── AddonHost.ts        # Exposes window.MicroMail SDK, dynamic import() host
│   │   │   └── SlotRenderer.tsx    # Mounts addon controls in UI slots
│   │   ├── components/             # Sidebar, ThreadList, MessageReader, ComposeModal, AddonStoreView, DNSSetupView
│   │   └── App.tsx                 # Core app state & SSE subscriber
│   ├── package.json
│   └── vite.config.ts
├── examples/
│   └── addons/
│       ├── voice-search-wasm/      # Sample frontend addon registering voice search in search bar
│       └── spam-bayes-wasm/        # Sample TinyGo/Rust backend WASI spam filter
├── Dockerfile                      # Multi-stage distroless build (22 MB final image)
├── docker-compose.yml              # MicroMail + Cloudflare Tunnel orchestration
└── README.md
```

---

## Universal Addon Contract

### Manifest Specification (`addon.json`)

Every addon `.zip` contains an `addon.json` at its root:

```json
{
  "id": "official.voice-search",
  "name": "Offline Voice Search (WASM)",
  "version": "1.0.0",
  "runtime": "frontend",
  "description": "Search your inbox by voice using an embedded 13 MB local WASM speech model.",
  "permissions": ["ui:search_bar", "ui:set_search_query"],
  "frontend": {
    "entry": "ui/index.js",
    "slots": ["search_bar_action"]
  },
  "config_schema": [
    { "key": "language", "type": "select", "options": ["en", "es", "fr", "de"], "default": "en", "label": "Language" },
    { "key": "auto_submit", "type": "boolean", "default": true, "label": "Submit search automatically" }
  ]
}
```

### Backend WASM ABI (`wazero` Stdin/Stdout JSON)

Backend modules run inside a memory-capped, isolated WASI environment with execution timeouts (default: 1500 ms).

1. **Host sends JSON to guest `stdin`:**
```json
{
  "hook": "on_inbound_pre_store",
  "config": { "threshold": 0.75 },
  "email": {
    "from": "sender@example.com",
    "to": ["you@yourdomain.com"],
    "subject": "Invoice attached",
    "headers": { "Authentication-Results": "spf=pass; dkim=pass" },
    "body_text": "..."
  }
}
```

2. **Guest writes JSON to `stdout` and exits `0`:**
```json
{
  "action": "accept",
  "spam_score": 0.12,
  "tags": ["verified-sender"]
}
```
*Valid actions: `"accept"`, `"spam"` (routes to Spam mailbox), or `"reject"` (SMTP 550 reject). If the module times out or fails, MicroMail logs the failure and safely defaults to `"accept"` so mail delivery is never interrupted.*

### Frontend SDK (`window.MicroMail`)

Frontend addons are standard ES modules served directly with immutable HTTP caching. Addons implement an `init(sdk)` export:

```javascript
export default {
  init(sdk) {
    sdk.registerSlot("search_bar_action", {
      render(container) {
        const btn = document.createElement("button");
        btn.textContent = "Voice Search";
        btn.onclick = () => sdk.setSearchQuery("quarterly report");
        container.appendChild(btn);
      }
    });
  }
};
```

---

## Quick Start & Deployment

### 1. Build and Run with Docker Compose

You can build locally or pull the pre-built multi-arch image from GitHub Container Registry (GHCR):

```bash
# Pull and start using docker compose
docker compose up -d --build
```

Or run directly from GitHub Packages:
```bash
docker run -d \
  --name micromail \
  -p 25:25 -p 587:587 -p 993:993 -p 8080:8080 \
  -v ./mail-data:/data \
  -e MAIL_DOMAIN=yourdomain.com \
  ghcr.io/<your-github-username>/micromail:latest
```

Access the Webmail and Addon Store at `http://localhost:8080`.
Default admin credentials:
- **Email:** `postmaster@localhost`
- **Password:** `admin123`

### 2. DNS Configuration (Cloudflare DNS)

| Type | Name | Value | Proxy Status |
| --- | --- | --- | --- |
| `A` | `mail` | `<YOUR_SERVER_PUBLIC_IP>` | **DNS Only (Grey Cloud)** |
| `MX` | `@` | `mail.yourdomain.com` (Priority 10) | **DNS Only (Grey Cloud)** |
| `CNAME` | `webmail` | `<TUNNEL_ID>.cfargotunnel.com` | **Proxied (Orange Cloud)** |
| `TXT` | `@` | `v=spf1 mx -all` | **DNS Only** |
| `TXT` | `default._domainkey` | `v=DKIM1; k=rsa; p=<AUTO_GENERATED_PUBLIC_KEY>` | **DNS Only** |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@yourdomain.com` | **DNS Only** |
| `PTR` | `<IP>` | `mail.yourdomain.com` | Set in VPS provider control panel |

---

## Local Development

### Prerequisites
- Go 1.24+
- Node.js 22+

### Running Locally
```bash
# 1. Build frontend
cd web
npm install
npm run build
cd ..

# 2. Run backend
export DATA_DIR="./data"
export MAIL_DOMAIN="localhost"
go run ./cmd/micromail
```
Open `http://localhost:8080` in your browser.

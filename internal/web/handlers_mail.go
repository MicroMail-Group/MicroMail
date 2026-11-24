package web

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
)

type MailHandlers struct {
	cfg      *config.Config
	store    *store.Store
	outbound *mail.OutboundQueue
	broadcaster *SSEBroadcaster
	dkimMgr  *mail.DKIMManager
}

func NewMailHandlers(cfg *config.Config, s *store.Store, outbound *mail.OutboundQueue, b *SSEBroadcaster, dkimMgr *mail.DKIMManager) *MailHandlers {
	return &MailHandlers{
		cfg:         cfg,
		store:       s,
		outbound:    outbound,
		broadcaster: b,
		dkimMgr:     dkimMgr,
	}
}

func (h *MailHandlers) GetFolders(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	counts, err := h.store.GetFolderCounts(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, counts)
}

func (h *MailHandlers) ListThreads(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "INBOX"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	threads, err := h.store.ListThreads(user.ID, folder, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, threads)
}

func (h *MailHandlers) GetThreadMessages(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	threadID := r.PathValue("id")
	if threadID == "" {
		threadID = r.URL.Query().Get("id")
	}

	messages, err := h.store.GetUserThreadMessages(user.ID, threadID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Automatically mark unread messages in this thread as read upon viewing
	_ = h.store.UpdateUserThreadRead(user.ID, threadID, true)
	for _, m := range messages {
		m.IsRead = true
		// Automatically resolve inline cid: images if present
		if strings.Contains(m.BodyHTML, "cid:") {
			if newHTML, newAtts, changed := mail.ResolveMessageInlineImages(h.cfg.DataDir, m.BodyHTML, toMailAttachments(m.Attachments), m.RawBlobPath); changed {
				m.BodyHTML = newHTML
				m.Attachments = toStoreAttachments(newAtts)
				_ = h.store.UpdateMessageBodyAndAttachments(m.ID, m.BodyHTML, m.Attachments)
			}
		}
	}

	writeJSON(w, http.StatusOK, messages)
}

func (h *MailHandlers) GetMessage(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	msgID := r.PathValue("id")
	msg, err := h.store.GetMessageByID(msgID)
	if err != nil || msg == nil || msg.UserID != user.ID {
		http.Error(w, "Message not found", http.StatusNotFound)
		return
	}

	// Automatically resolve inline cid: images if present
	if strings.Contains(msg.BodyHTML, "cid:") {
		if newHTML, newAtts, changed := mail.ResolveMessageInlineImages(h.cfg.DataDir, msg.BodyHTML, toMailAttachments(msg.Attachments), msg.RawBlobPath); changed {
			msg.BodyHTML = newHTML
			msg.Attachments = toStoreAttachments(newAtts)
			_ = h.store.UpdateMessageBodyAndAttachments(msg.ID, msg.BodyHTML, msg.Attachments)
		}
	}

	writeJSON(w, http.StatusOK, msg)
}

type MarkReadRequest struct {
	IsRead bool `json:"is_read"`
}

func (h *MailHandlers) MarkRead(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	msgID := r.PathValue("id")
	var req MarkReadRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if err := h.store.UpdateUserMessageRead(user.ID, msgID, req.IsRead); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *MailHandlers) MarkThreadRead(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	threadID := r.PathValue("id")
	var req MarkReadRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if err := h.store.UpdateUserThreadRead(user.ID, threadID, req.IsRead); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type MoveMessageRequest struct {
	Folder string `json:"folder"`
}

func (h *MailHandlers) MoveMessage(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	msgID := r.PathValue("id")
	var req MoveMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.store.MoveUserMessage(user.ID, msgID, req.Folder); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *MailHandlers) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	msgID := r.PathValue("id")
	if err := h.store.DeleteUserMessage(user.ID, msgID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *MailHandlers) MoveThread(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	threadID := r.PathValue("id")
	var req MoveMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.store.MoveUserThread(user.ID, threadID, req.Folder); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *MailHandlers) DeleteThread(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	threadID := r.PathValue("id")
	if err := h.store.DeleteUserThread(user.ID, threadID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type SendMessageRequest struct {
	To          []string                  `json:"to"`
	Cc          []string                  `json:"cc"`
	Subject     string                    `json:"subject"`
	BodyText    string                    `json:"body_text"`
	BodyHTML    string                    `json:"body_html"`
	Attachments []mail.OutboundAttachment `json:"attachments"`
	InReplyTo   string                    `json:"in_reply_to"`
	ThreadID    string                    `json:"thread_id"`
}

func (h *MailHandlers) SendMessage(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.To) == 0 {
		http.Error(w, "At least one recipient is required", http.StatusBadRequest)
		return
	}

	msg, err := h.outbound.ComposeAndSend(user, req.To, req.Cc, req.Subject, req.BodyText, req.BodyHTML, req.Attachments, req.InReplyTo, req.ThreadID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, msg)
}

func (h *MailHandlers) SaveDraft(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	from := user.Email
	if !strings.Contains(from, "@") {
		from = fmt.Sprintf("%s@%s", user.Email, h.cfg.MailDomain)
	}

	snippet := strings.Join(strings.Fields(req.BodyText), " ")
	if len(snippet) > 160 {
		snippet = snippet[:157] + "..."
	}

	allRecipients := append([]string{}, req.To...)
	allRecipients = append(allRecipients, req.Cc...)

	msg := &store.Message{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Folder:     "Drafts",
		Sender:     from,
		Recipients: allRecipients,
		Subject:    req.Subject,
		Snippet:    snippet,
		BodyText:   req.BodyText,
		BodyHTML:   req.BodyHTML,
		IsRead:     true,
		CreatedAt:  time.Now().Unix(),
	}

	if err := h.store.CreateMessage(msg); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, msg)
}

func (h *MailHandlers) Search(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	results, err := h.store.SearchMessages(user.ID, q, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, results)
}

func (h *MailHandlers) DownloadBlob(w http.ResponseWriter, r *http.Request) {
	relPath := strings.TrimPrefix(r.URL.Path, "/api/blobs/")
	cleanRel := filepath.Clean(relPath)
	if strings.HasPrefix(cleanRel, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absPath := filepath.Join(h.cfg.DataDir, "blobs", cleanRel)
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	http.ServeFile(w, r, absPath)
}

func (h *MailHandlers) GetDKIMInfo(w http.ResponseWriter, r *http.Request) {
	if h.dkimMgr == nil {
		http.Error(w, "DKIM not configured", http.StatusNotFound)
		return
	}

	info := map[string]string{
		"domain":     h.cfg.MailDomain,
		"selector":   h.cfg.DKIMSelector,
		"dns_name":   fmt.Sprintf("%s._domainkey.%s", h.cfg.DKIMSelector, h.cfg.MailDomain),
		"dns_record": h.dkimMgr.DNSRecord,
		"public_key": h.dkimMgr.PublicKeyB64,
	}
	writeJSON(w, http.StatusOK, info)
}

func (h *MailHandlers) ProxyImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		http.Error(w, "Invalid target URL", http.StatusBadRequest)
		return
	}

	hostname := parsed.Hostname()
	if isPrivateOrLoopbackHost(hostname) {
		http.Error(w, "Forbidden host", http.StatusForbidden)
		return
	}

	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("stopped after 5 redirects")
			}
			if isPrivateOrLoopbackHost(req.URL.Hostname()) {
				return fmt.Errorf("redirect to private address blocked")
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 MicroMail/1.0")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "Failed to fetch image: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		http.Error(w, fmt.Sprintf("Upstream returned %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	limitReader := io.LimitReader(resp.Body, 15*1024*1024)
	bodyBytes, err := io.ReadAll(limitReader)
	if err != nil {
		http.Error(w, "Failed to read image body", http.StatusInternalServerError)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		detected := http.DetectContentType(bodyBytes)
		if strings.HasPrefix(detected, "image/") {
			contentType = detected
		} else {
			contentType = "image/png"
		}
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bodyBytes)
}

func isPrivateOrLoopbackHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return true
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return true
	}

	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}

func toMailAttachments(atts []store.AttachmentMeta) []mail.AttachmentMeta {
	res := make([]mail.AttachmentMeta, len(atts))
	for i, a := range atts {
		res[i] = mail.AttachmentMeta{
			Filename:    a.Filename,
			ContentType: a.ContentType,
			Size:        a.Size,
			Path:        a.Path,
			ContentID:   a.ContentID,
		}
	}
	return res
}

func toStoreAttachments(atts []mail.AttachmentMeta) []store.AttachmentMeta {
	res := make([]store.AttachmentMeta, len(atts))
	for i, a := range atts {
		res[i] = store.AttachmentMeta{
			Filename:    a.Filename,
			ContentType: a.ContentType,
			Size:        a.Size,
			Path:        a.Path,
			ContentID:   a.ContentID,
		}
	}
	return res
}

package web

import (
	"encoding/json"
	"fmt"
	"net/http"
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

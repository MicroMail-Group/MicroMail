package mail

import (
	"bytes"
	"crypto"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/emersion/go-msgauth/dkim"
	"github.com/google/uuid"
	"micromail/internal/config"
	"micromail/internal/store"
)

type OutboundAttachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	DataBase64  string `json:"data_base64"`
}

type OutboundQueue struct {
	cfg     *config.Config
	store   *store.Store
	dkimMgr *DKIMManager
}

func NewOutboundQueue(cfg *config.Config, s *store.Store, dkimMgr *DKIMManager) *OutboundQueue {
	return &OutboundQueue{
		cfg:     cfg,
		store:   s,
		dkimMgr: dkimMgr,
	}
}

func (q *OutboundQueue) SignDKIM(rawMIME []byte) ([]byte, error) {
	if q.dkimMgr == nil || q.dkimMgr.PrivateKey == nil {
		return rawMIME, nil
	}

	options := &dkim.SignOptions{
		Domain:   q.cfg.MailDomain,
		Selector: q.cfg.DKIMSelector,
		Signer:   q.dkimMgr.PrivateKey,
		Hash:     crypto.SHA256,
		HeaderKeys: []string{
			"From", "To", "Subject", "Date", "Message-ID",
		},
	}

	var signed bytes.Buffer
	err := dkim.Sign(&signed, bytes.NewReader(rawMIME), options)
	if err != nil {
		return nil, fmt.Errorf("failed to sign DKIM: %w", err)
	}

	return signed.Bytes(), nil
}

func (q *OutboundQueue) EnqueueAndSend(user *store.User, from string, recipients []string, rawMIME []byte, threadID ...string) error {
	// Sign with DKIM
	signedData, err := q.SignDKIM(rawMIME)
	if err != nil {
		log.Printf("[Outbound] DKIM signing error: %v, sending unsigned", err)
		signedData = rawMIME
	}

	var tid string
	if len(threadID) > 0 {
		tid = threadID[0]
	}

	// Save copy to user's Sent folder
	parsed, _ := ParseMIME(signedData, q.cfg.DataDir)
	blobPath, _ := SaveRawEmailBlob(q.cfg.DataDir, signedData)

	sentMsg := &store.Message{
		UserID:          user.ID,
		Folder:          "Sent",
		ThreadID:        tid,
		MessageIDHeader: parsed.MessageIDHeader,
		InReplyTo:       parsed.InReplyTo,
		Sender:          from,
		Recipients:      recipients,
		Subject:         parsed.Subject,
		Snippet:         parsed.Snippet,
		BodyText:        parsed.BodyText,
		BodyHTML:        parsed.BodyHTML,
		RawBlobPath:     blobPath,
		IsRead:          true,
		CreatedAt:       time.Now().Unix(),
	}
	_ = q.store.CreateMessage(sentMsg)

	// Group recipients by domain
	domainMap := make(map[string][]string)
	for _, rcpt := range recipients {
		parts := strings.Split(rcpt, "@")
		if len(parts) == 2 {
			domain := strings.ToLower(parts[1])
			domainMap[domain] = append(domainMap[domain], rcpt)
		}
	}

	// Deliver to each domain
	for domain, domainRcpts := range domainMap {
		// If domain is local domain, deliver locally
		if domain == strings.ToLower(q.cfg.MailDomain) {
			for _, localRcpt := range domainRcpts {
				localUser, err := q.store.GetUserByEmail(localRcpt)
				if err == nil && localUser != nil {
					inboxMsg := &store.Message{
						UserID:          localUser.ID,
						Folder:          "INBOX",
						ThreadID:        tid,
						MessageIDHeader: parsed.MessageIDHeader,
						InReplyTo:       parsed.InReplyTo,
						Sender:          from,
						Recipients:      recipients,
						Subject:         parsed.Subject,
						Snippet:         parsed.Snippet,
						BodyText:        parsed.BodyText,
						BodyHTML:        parsed.BodyHTML,
						RawBlobPath:     blobPath,
						IsRead:          false,
						CreatedAt:       time.Now().Unix(),
					}
					_ = q.store.CreateMessage(inboxMsg)
				}
			}
			continue
		}

		// Remote delivery via MX
		go func(dom string, rcpts []string, data []byte) {
			if err := q.deliverToDomain(dom, from, rcpts, data); err != nil {
				log.Printf("[Outbound] Delivery to %s failed: %v", dom, err)
			} else {
				log.Printf("[Outbound] Successfully delivered email to %s for %v", dom, rcpts)
			}
		}(domain, domainRcpts, signedData)
	}

	return nil
}

func (q *OutboundQueue) deliverToDomain(domain, from string, recipients []string, data []byte) error {
	mxs, err := net.LookupMX(domain)
	if err != nil || len(mxs) == 0 {
		return fmt.Errorf("no MX records found for %s: %w", domain, err)
	}

	// Sort MX by preference
	sort.Slice(mxs, func(i, j int) bool {
		return mxs[i].Pref < mxs[j].Pref
	})

	var lastErr error
	for _, mx := range mxs {
		host := strings.TrimSuffix(mx.Host, ".")
		addr := net.JoinHostPort(host, "25")

		conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
		if err != nil {
			lastErr = err
			continue
		}

		client, err := smtp.NewClient(conn, host)
		if err != nil {
			conn.Close()
			lastErr = err
			continue
		}

		// Try STARTTLS
		if ok, _ := client.Extension("STARTTLS"); ok {
			tlsConfig := &tls.Config{
				ServerName:         host,
				InsecureSkipVerify: false,
			}
			if err := client.StartTLS(tlsConfig); err != nil {
				log.Printf("[Outbound] STARTTLS failed with %s: %v, continuing plain", host, err)
			}
		}

		if err := client.Mail(from); err != nil {
			client.Close()
			lastErr = err
			continue
		}

		hasValidRcpt := false
		for _, rcpt := range recipients {
			if err := client.Rcpt(rcpt); err == nil {
				hasValidRcpt = true
			}
		}

		if !hasValidRcpt {
			client.Close()
			lastErr = fmt.Errorf("all recipients rejected by %s", host)
			continue
		}

		w, err := client.Data()
		if err != nil {
			client.Close()
			lastErr = err
			continue
		}

		_, err = w.Write(data)
		if err != nil {
			w.Close()
			client.Close()
			lastErr = err
			continue
		}
		_ = w.Close()
		_ = client.Quit()
		return nil
	}

	return fmt.Errorf("failed delivering to all MX servers for %s: %w", domain, lastErr)
}

func (q *OutboundQueue) ComposeAndSend(user *store.User, to []string, cc []string, subject, bodyText, bodyHTML string, attachments []OutboundAttachment, replyContext ...string) (*store.Message, error) {
	from := user.Email
	if !strings.Contains(from, "@") {
		from = fmt.Sprintf("%s@%s", user.Email, q.cfg.MailDomain)
	}

	var inReplyTo, threadID string
	if len(replyContext) > 0 {
		inReplyTo = replyContext[0]
	}
	if len(replyContext) > 1 {
		threadID = replyContext[1]
	}

	dateStr := time.Now().UTC().Format(time.RFC1123Z)
	messageID := fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), user.ID, q.cfg.MailDomain)

	var b bytes.Buffer
	b.WriteString(fmt.Sprintf("From: %s\r\n", from))
	b.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(to, ", ")))
	if len(cc) > 0 {
		b.WriteString(fmt.Sprintf("Cc: %s\r\n", strings.Join(cc, ", ")))
	}
	b.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	b.WriteString(fmt.Sprintf("Date: %s\r\n", dateStr))
	b.WriteString(fmt.Sprintf("Message-ID: %s\r\n", messageID))
	if inReplyTo != "" {
		cleanRef := strings.Trim(inReplyTo, "<>")
		b.WriteString(fmt.Sprintf("In-Reply-To: <%s>\r\n", cleanRef))
		b.WriteString(fmt.Sprintf("References: <%s>\r\n", cleanRef))
	}
	b.WriteString("MIME-Version: 1.0\r\n")

	var savedAttachments []store.AttachmentMeta

	if len(attachments) > 0 {
		mixedBoundary := fmt.Sprintf("mixed_%d", time.Now().UnixNano())
		b.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=\"%s\"\r\n\r\n", mixedBoundary))

		// 1. Body part
		b.WriteString(fmt.Sprintf("--%s\r\n", mixedBoundary))
		if bodyHTML != "" {
			altBoundary := fmt.Sprintf("alt_%d", time.Now().UnixNano())
			b.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", altBoundary))
			b.WriteString(fmt.Sprintf("--%s\r\n", altBoundary))
			b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyText)
			b.WriteString(fmt.Sprintf("\r\n--%s\r\n", altBoundary))
			b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyHTML)
			b.WriteString(fmt.Sprintf("\r\n--%s--\r\n", altBoundary))
		} else {
			b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyText)
			b.WriteString("\r\n")
		}

		// 2. Attachment parts
		now := time.Now()
		relDir := filepath.Join(fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())))
		absDir := filepath.Join(q.cfg.DataDir, "blobs", relDir)
		_ = os.MkdirAll(absDir, 0755)

		for _, att := range attachments {
			fileBytes, err := base64.StdEncoding.DecodeString(att.DataBase64)
			if err != nil {
				continue
			}

			attFilename := fmt.Sprintf("%s_%s", uuid.New().String(), filepath.Base(att.Filename))
			absAttPath := filepath.Join(absDir, attFilename)
			_ = os.WriteFile(absAttPath, fileBytes, 0644)

			relPath := filepath.Join(relDir, attFilename)
			cType := att.ContentType
			if cType == "" {
				cType = "application/octet-stream"
			}

			savedAttachments = append(savedAttachments, store.AttachmentMeta{
				Filename:    att.Filename,
				ContentType: cType,
				Size:        int64(len(fileBytes)),
				Path:        relPath,
			})

			b.WriteString(fmt.Sprintf("--%s\r\n", mixedBoundary))
			b.WriteString(fmt.Sprintf("Content-Type: %s; name=\"%s\"\r\n", cType, att.Filename))
			b.WriteString(fmt.Sprintf("Content-Disposition: attachment; filename=\"%s\"\r\n", att.Filename))
			b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")

			// Wrap base64 to 76 chars
			b64Str := att.DataBase64
			for len(b64Str) > 76 {
				b.WriteString(b64Str[:76] + "\r\n")
				b64Str = b64Str[76:]
			}
			if len(b64Str) > 0 {
				b.WriteString(b64Str + "\r\n")
			}
		}

		b.WriteString(fmt.Sprintf("--%s--\r\n", mixedBoundary))
	} else {
		// Single body without attachments
		boundary := fmt.Sprintf("micromail_%d", time.Now().UnixNano())
		if bodyHTML != "" {
			b.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary))
			b.WriteString(fmt.Sprintf("--%s\r\n", boundary))
			b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyText)
			b.WriteString(fmt.Sprintf("\r\n--%s\r\n", boundary))
			b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyHTML)
			b.WriteString(fmt.Sprintf("\r\n--%s--\r\n", boundary))
		} else {
			b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
			b.WriteString(bodyText)
		}
	}

	raw := b.Bytes()

	allRecipients := append([]string{}, to...)
	allRecipients = append(allRecipients, cc...)

	if err := q.EnqueueAndSend(user, from, allRecipients, raw, threadID); err != nil {
		return nil, err
	}

	snippet := strings.Join(strings.Fields(bodyText), " ")
	if len(snippet) > 160 {
		snippet = snippet[:157] + "..."
	}

	msg := &store.Message{
		UserID:          user.ID,
		Folder:          "Sent",
		MessageIDHeader: messageID,
		Sender:          from,
		Recipients:      allRecipients,
		Subject:         subject,
		Snippet:         snippet,
		BodyText:        bodyText,
		BodyHTML:        bodyHTML,
		Attachments:     savedAttachments,
		IsRead:          true,
		CreatedAt:       time.Now().Unix(),
	}

	return msg, nil
}

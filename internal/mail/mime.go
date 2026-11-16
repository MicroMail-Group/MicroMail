package mail

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/emersion/go-message/mail"
	"github.com/google/uuid"
)

type ParsedEmail struct {
	MessageIDHeader string
	InReplyTo       string
	References      string
	From            string
	To              []string
	Cc              []string
	Subject         string
	Date            time.Time
	Snippet         string
	BodyText        string
	BodyHTML        string
	Headers         map[string]string
	Attachments     []AttachmentMeta
	RawBlobPath     string
}

type AttachmentMeta struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Path        string `json:"path"`
}

func SaveRawEmailBlob(dataDir string, raw []byte) (string, error) {
	now := time.Now()
	relDir := filepath.Join(fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())))
	absDir := filepath.Join(dataDir, "blobs", relDir)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return "", err
	}

	filename := fmt.Sprintf("%s.eml", uuid.New().String())
	absPath := filepath.Join(absDir, filename)

	if err := os.WriteFile(absPath, raw, 0644); err != nil {
		return "", err
	}

	// Return relative path from blobs directory for portability
	return filepath.Join(relDir, filename), nil
}

func ParseMIME(raw []byte, dataDir string) (*ParsedEmail, error) {
	mr, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		// Fallback simple line parsing if reader fails
		return fallbackParseRaw(raw)
	}

	header := mr.Header
	parsed := &ParsedEmail{
		Headers: make(map[string]string),
	}

	// Extract standard headers
	if fromList, err := header.AddressList("From"); err == nil && len(fromList) > 0 {
		parsed.From = fromList[0].Address
	} else {
		parsed.From = header.Get("From")
	}

	if toList, err := header.AddressList("To"); err == nil {
		for _, addr := range toList {
			parsed.To = append(parsed.To, addr.Address)
		}
	} else if to := header.Get("To"); to != "" {
		parsed.To = []string{to}
	}

	if ccList, err := header.AddressList("Cc"); err == nil {
		for _, addr := range ccList {
			parsed.Cc = append(parsed.Cc, addr.Address)
		}
	}

	parsed.Subject = header.Get("Subject")
	parsed.MessageIDHeader = header.Get("Message-ID")
	parsed.InReplyTo = header.Get("In-Reply-To")
	parsed.References = header.Get("References")
	if parsed.InReplyTo == "" && parsed.References != "" {
		refParts := strings.Fields(parsed.References)
		if len(refParts) > 0 {
			parsed.InReplyTo = refParts[len(refParts)-1]
		}
	}
	if date, err := header.Date(); err == nil {
		parsed.Date = date
	} else {
		parsed.Date = time.Now()
	}

	// Store raw header map
	fields := header.Fields()
	for fields.Next() {
		parsed.Headers[fields.Key()] = fields.Value()
	}

	// Parse body parts
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}

		switch h := p.Header.(type) {
		case *mail.InlineHeader:
			contentType, _, _ := h.ContentType()
			b, _ := io.ReadAll(p.Body)
			if strings.HasPrefix(contentType, "text/plain") {
				if parsed.BodyText == "" {
					parsed.BodyText = string(b)
				} else {
					parsed.BodyText += "\n" + string(b)
				}
			} else if strings.HasPrefix(contentType, "text/html") {
				if parsed.BodyHTML == "" {
					parsed.BodyHTML = string(b)
				} else {
					parsed.BodyHTML += "\n" + string(b)
				}
			}
		case *mail.AttachmentHeader:
			filename, _ := h.Filename()
			if filename == "" {
				filename = "attachment.dat"
			}
			contentType, _, _ := h.ContentType()

			now := time.Now()
			relDir := filepath.Join(fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())))
			absDir := filepath.Join(dataDir, "blobs", relDir)
			_ = os.MkdirAll(absDir, 0755)

			attFile := fmt.Sprintf("%s_%s", uuid.New().String(), filepath.Base(filename))
			absAttPath := filepath.Join(absDir, attFile)

			f, err := os.Create(absAttPath)
			if err == nil {
				n, _ := io.Copy(f, p.Body)
				f.Close()
				parsed.Attachments = append(parsed.Attachments, AttachmentMeta{
					Filename:    filename,
					ContentType: contentType,
					Size:        n,
					Path:        filepath.Join(relDir, attFile),
				})
			}
		}
	}

	// Generate snippet from BodyText or BodyHTML
	text := strings.TrimSpace(parsed.BodyText)
	if text == "" && parsed.BodyHTML != "" {
		text = stripHTML(parsed.BodyHTML)
	}
	text = strings.ReplaceAll(text, "\n", " ")
	text = strings.ReplaceAll(text, "\r", "")
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > 160 {
		parsed.Snippet = text[:157] + "..."
	} else {
		parsed.Snippet = text
	}

	return parsed, nil
}

func stripHTML(html string) string {
	var inTag bool
	var b strings.Builder
	for _, r := range html {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func fallbackParseRaw(raw []byte) (*ParsedEmail, error) {
	str := string(raw)
	parts := strings.SplitN(str, "\r\n\r\n", 2)
	if len(parts) < 2 {
		parts = strings.SplitN(str, "\n\n", 2)
	}

	headerText := parts[0]
	bodyText := ""
	if len(parts) > 1 {
		bodyText = parts[1]
	}

	parsed := &ParsedEmail{
		Date:     time.Now(),
		BodyText: bodyText,
		Headers:  make(map[string]string),
	}

	lines := strings.Split(headerText, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if idx := strings.Index(l, ":"); idx > 0 {
			k := strings.TrimSpace(l[:idx])
			v := strings.TrimSpace(l[idx+1:])
			parsed.Headers[k] = v
			switch strings.ToLower(k) {
			case "from":
				parsed.From = v
			case "to":
				parsed.To = strings.Split(v, ",")
			case "subject":
				parsed.Subject = v
			case "message-id":
				parsed.MessageIDHeader = v
			case "in-reply-to":
				parsed.InReplyTo = v
			case "references":
				parsed.References = v
				if parsed.InReplyTo == "" {
					refParts := strings.Fields(v)
					if len(refParts) > 0 {
						parsed.InReplyTo = refParts[len(refParts)-1]
					}
				}
			}
		}
	}

	snippet := strings.Join(strings.Fields(bodyText), " ")
	if len(snippet) > 160 {
		parsed.Snippet = snippet[:157] + "..."
	} else {
		parsed.Snippet = snippet
	}

	return parsed, nil
}

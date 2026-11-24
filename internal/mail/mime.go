package mail

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/emersion/go-message"
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
	ContentID   string `json:"content_id,omitempty"`
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
	cidMap := make(map[string]string)
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
			} else if strings.HasPrefix(contentType, "image/") || h.Get("Content-ID") != "" {
				// Inline image (e.g. USPS barcode, scan, tracking graphic, logo)
				contentID := strings.Trim(h.Get("Content-ID"), "<>")
				filename := extractFilenameFromHeader(h.Header, contentID, contentType)

				now := time.Now()
				relDir := filepath.Join(fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())))
				absDir := filepath.Join(dataDir, "blobs", relDir)
				_ = os.MkdirAll(absDir, 0755)

				attFile := fmt.Sprintf("%s_%s", uuid.New().String(), filepath.Base(filename))
				absAttPath := filepath.Join(absDir, attFile)

				if err := os.WriteFile(absAttPath, b, 0644); err == nil {
					relPath := filepath.ToSlash(filepath.Join(relDir, attFile))
					parsed.Attachments = append(parsed.Attachments, AttachmentMeta{
						Filename:    filename,
						ContentType: contentType,
						Size:        int64(len(b)),
						Path:        relPath,
						ContentID:   contentID,
					})
					blobURL := "/api/blobs/" + relPath
					if contentID != "" {
						cidMap[contentID] = blobURL
						cidMap["<"+contentID+">"] = blobURL
					}
					if filename != "" {
						cidMap[filename] = blobURL
					}
				}
			}
		case *mail.AttachmentHeader:
			filename, _ := h.Filename()
			contentType, _, _ := h.ContentType()
			contentID := strings.Trim(h.Get("Content-ID"), "<>")
			if filename == "" {
				if contentID != "" {
					filename = contentID
				} else {
					filename = "attachment.dat"
				}
			}

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
				relPath := filepath.ToSlash(filepath.Join(relDir, attFile))
				parsed.Attachments = append(parsed.Attachments, AttachmentMeta{
					Filename:    filename,
					ContentType: contentType,
					Size:        n,
					Path:        relPath,
					ContentID:   contentID,
				})
				if contentID != "" {
					blobURL := "/api/blobs/" + relPath
					cidMap[contentID] = blobURL
					cidMap["<"+contentID+">"] = blobURL
				}
			}
		}
	}

	// Resolve any cid: inline image references in HTML body
	for cid, blobURL := range cidMap {
		parsed.BodyHTML = replaceCID(parsed.BodyHTML, cid, blobURL)
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

func extractFilenameFromHeader(header message.Header, contentID, contentType string) string {
	if _, params, err := header.ContentDisposition(); err == nil && params["filename"] != "" {
		return filepath.Base(params["filename"])
	}
	if _, params, err := header.ContentType(); err == nil && params["name"] != "" {
		return filepath.Base(params["name"])
	}

	ext := ".dat"
	switch strings.ToLower(contentType) {
	case "image/jpeg", "image/jpg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	case "image/svg+xml":
		ext = ".svg"
	case "image/bmp":
		ext = ".bmp"
	}

	if contentID != "" {
		cleanID := strings.Trim(contentID, "<>")
		safeID := strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
				return r
			}
			return '_'
		}, cleanID)
		if !strings.Contains(safeID, ".") {
			safeID += ext
		}
		return safeID
	}
	return "inline_image" + ext
}

func replaceCID(html, cid, blobURL string) string {
	if html == "" || cid == "" || blobURL == "" {
		return html
	}
	cleanCID := strings.Trim(cid, "<>")
	targets := []string{
		"cid:" + cleanCID,
		"cid:<" + cleanCID + ">",
		"cid:" + cid,
	}
	for _, target := range targets {
		html = strings.ReplaceAll(html, `"`+target+`"`, `"`+blobURL+`"`)
		html = strings.ReplaceAll(html, `'`+target+`'`, `'`+blobURL+`'`)
		html = strings.ReplaceAll(html, `\"`+target+`\"`, `\"`+blobURL+`\"`)
		html = strings.ReplaceAll(html, `(`+target+`)`, `(`+blobURL+`)`)
		html = strings.ReplaceAll(html, `('`+target+`')`, `('`+blobURL+`')`)
		html = strings.ReplaceAll(html, `("`+target+`")`, `("`+blobURL+`")`)
		html = strings.ReplaceAll(html, target, blobURL)
	}
	return html
}

func ResolveMessageInlineImages(dataDir string, bodyHTML string, attachments []AttachmentMeta, rawBlobPath string) (string, []AttachmentMeta, bool) {
	if !strings.Contains(bodyHTML, "cid:") {
		return bodyHTML, attachments, false
	}

	cidMap := make(map[string]string)
	for _, att := range attachments {
		if att.ContentID != "" && att.Path != "" {
			url := "/api/blobs/" + filepath.ToSlash(att.Path)
			cidMap[att.ContentID] = url
			cidMap[strings.Trim(att.ContentID, "<>")] = url
		}
		if att.Filename != "" && att.Path != "" {
			url := "/api/blobs/" + filepath.ToSlash(att.Path)
			cidMap[att.Filename] = url
		}
	}

	updatedAttachments := append([]AttachmentMeta(nil), attachments...)
	modified := false

	if rawBlobPath != "" {
		absBlob := filepath.Join(dataDir, "blobs", rawBlobPath)
		if rawBytes, err := os.ReadFile(absBlob); err == nil {
			parsed, err := ParseMIME(rawBytes, dataDir)
			if err == nil {
				for _, att := range parsed.Attachments {
					if att.ContentID != "" {
						url := "/api/blobs/" + filepath.ToSlash(att.Path)
						cidMap[att.ContentID] = url
						cidMap[strings.Trim(att.ContentID, "<>")] = url
						found := false
						for _, existing := range updatedAttachments {
							if existing.Path == att.Path || (existing.ContentID != "" && existing.ContentID == att.ContentID) {
								found = true
								break
							}
						}
						if !found {
							updatedAttachments = append(updatedAttachments, att)
							modified = true
						}
					}
				}
			}
		}
	}

	newBodyHTML := bodyHTML
	for cid, url := range cidMap {
		if strings.Contains(newBodyHTML, cid) {
			newBodyHTML = replaceCID(newBodyHTML, cid, url)
			modified = true
		}
	}

	return newBodyHTML, updatedAttachments, modified
}

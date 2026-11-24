package mail

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDKIMAndMIME(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "micromail-mail-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// 1. DKIM key generation
	keyPath := filepath.Join(tempDir, "dkim", "default.private.pem")
	dkimMgr, err := LoadOrGenerateDKIM(keyPath, "default", "example.com")
	if err != nil {
		t.Fatalf("failed to generate DKIM: %v", err)
	}
	if !strings.HasPrefix(dkimMgr.DNSRecord, "v=DKIM1; k=rsa; p=") {
		t.Errorf("unexpected DKIM DNS record: %s", dkimMgr.DNSRecord)
	}

	// 2. MIME Parsing
	rawEmail := []byte("From: bob@example.com\r\n" +
		"To: alice@example.com\r\n" +
		"Subject: Hello MicroMail\r\n" +
		"Message-ID: <12345@example.com>\r\n" +
		"Date: Fri, 14 Nov 2026 12:00:00 +0000\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n" +
		"\r\n" +
		"This is a test message from bob to alice.\r\n")

	parsed, err := ParseMIME(rawEmail, tempDir)
	if err != nil {
		t.Fatalf("failed to parse MIME: %v", err)
	}
	if parsed.From != "bob@example.com" {
		t.Errorf("expected From bob@example.com, got %s", parsed.From)
	}
	if parsed.Subject != "Hello MicroMail" {
		t.Errorf("expected Subject 'Hello MicroMail', got %s", parsed.Subject)
	}
	if !strings.Contains(parsed.BodyText, "test message") {
		t.Errorf("expected body text to contain 'test message', got: %s", parsed.BodyText)
	}

	// 3. Save raw blob
	blobRel, err := SaveRawEmailBlob(tempDir, rawEmail)
	if err != nil {
		t.Fatalf("failed to save raw blob: %v", err)
	}
	absBlob := filepath.Join(tempDir, "blobs", blobRel)
	if _, err := os.Stat(absBlob); os.IsNotExist(err) {
		t.Errorf("blob file does not exist at %s", absBlob)
	}

	// 4. Inline image (CID) parsing & replacement (e.g. USPS package tracking / receipts)
	rawMultipartRelated := []byte("From: auto-reply@usps.gov\r\n" +
		"To: alice@example.com\r\n" +
		"Subject: Your USPS Delivery Update\r\n" +
		"Content-Type: multipart/related; boundary=\"boundary_12345\"\r\n" +
		"\r\n" +
		"--boundary_12345\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n" +
		"\r\n" +
		"<div><h1>USPS Delivery</h1><img src=\"cid:usps_logo_01@usps.com\"><p>In transit</p></div>\r\n" +
		"--boundary_12345\r\n" +
		"Content-Type: image/png\r\n" +
		"Content-ID: <usps_logo_01@usps.com>\r\n" +
		"Content-Disposition: inline; filename=\"logo.png\"\r\n" +
		"\r\n" +
		"\x89PNG\r\n\x1a\nfake_png_data\r\n" +
		"--boundary_12345--\r\n")

	parsedRelated, err := ParseMIME(rawMultipartRelated, tempDir)
	if err != nil {
		t.Fatalf("failed to parse multipart/related MIME: %v", err)
	}
	if len(parsedRelated.Attachments) == 0 {
		t.Fatalf("expected 1 inline image attachment, got 0")
	}
	att := parsedRelated.Attachments[0]
	if att.ContentID != "usps_logo_01@usps.com" {
		t.Errorf("expected ContentID 'usps_logo_01@usps.com', got: %s", att.ContentID)
	}
	if !strings.Contains(parsedRelated.BodyHTML, "/api/blobs/") {
		t.Errorf("expected BodyHTML to replace cid with /api/blobs/, got: %s", parsedRelated.BodyHTML)
	}

	// 5. Test ResolveMessageInlineImages with raw blob
	savedBlob, err := SaveRawEmailBlob(tempDir, rawMultipartRelated)
	if err != nil {
		t.Fatalf("failed to save raw blob: %v", err)
	}
	unresolvedHTML := "<div><img src=\"cid:usps_logo_01@usps.com\"></div>"
	resolvedHTML, newAtts, changed := ResolveMessageInlineImages(tempDir, unresolvedHTML, nil, savedBlob)
	if !changed {
		t.Errorf("expected ResolveMessageInlineImages to return changed=true")
	}
	if !strings.Contains(resolvedHTML, "/api/blobs/") {
		t.Errorf("expected resolvedHTML to contain /api/blobs/, got: %s", resolvedHTML)
	}
	if len(newAtts) == 0 {
		t.Errorf("expected newAtts to be populated from raw blob")
	}
}

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
}

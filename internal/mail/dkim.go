package mail

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
)

type DKIMManager struct {
	Selector    string
	Domain      string
	KeyPath     string
	PrivateKey  *rsa.PrivateKey
	DNSRecord   string
	PublicKeyB64 string
}

func LoadOrGenerateDKIM(keyPath, selector, domain string) (*DKIMManager, error) {
	if err := os.MkdirAll(filepath.Dir(keyPath), 0755); err != nil {
		return nil, err
	}

	var privKey *rsa.PrivateKey

	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		// Generate 2048-bit RSA key
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, fmt.Errorf("failed to generate RSA key: %w", err)
		}
		privKey = key

		der := x509.MarshalPKCS1PrivateKey(key)
		block := &pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: der,
		}

		if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0600); err != nil {
			return nil, fmt.Errorf("failed to write DKIM key to %s: %w", keyPath, err)
		}
	} else {
		data, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read DKIM key: %w", err)
		}
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, fmt.Errorf("failed to decode PEM block from %s", keyPath)
		}

		key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			// Try PKCS8
			pkcs8Key, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
			if err2 != nil {
				return nil, fmt.Errorf("failed to parse RSA private key: %w", err)
			}
			var ok bool
			privKey, ok = pkcs8Key.(*rsa.PrivateKey)
			if !ok {
				return nil, fmt.Errorf("key in %s is not an RSA private key", keyPath)
			}
		} else {
			privKey = key
		}
	}

	pubDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		return nil, err
	}
	pubB64 := base64.StdEncoding.EncodeToString(pubDER)
	dnsRecord := fmt.Sprintf("v=DKIM1; k=rsa; p=%s", pubB64)

	return &DKIMManager{
		Selector:     selector,
		Domain:       domain,
		KeyPath:      keyPath,
		PrivateKey:   privKey,
		DNSRecord:    dnsRecord,
		PublicKeyB64: pubB64,
	}, nil
}

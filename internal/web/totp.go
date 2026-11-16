package web

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var b32Encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTOTPSecret returns a 20-byte cryptographically random Base32 string (RFC 4648)
func GenerateTOTPSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	return b32Encoding.EncodeToString(b)
}

// ComputeTOTP computes the 6-digit TOTP code for a given timestamp
func ComputeTOTP(secretBase32 string, t time.Time) (string, error) {
	cleanSecret := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secretBase32), " ", ""))
	key, err := b32Encoding.DecodeString(cleanSecret)
	if err != nil {
		return "", fmt.Errorf("invalid base32 secret: %w", err)
	}

	counter := uint64(t.Unix() / 30)
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	h := mac.Sum(nil)

	offset := h[len(h)-1] & 0x0f
	binaryCode := binary.BigEndian.Uint32(h[offset:offset+4]) & 0x7fffffff
	code := binaryCode % 1000000

	return fmt.Sprintf("%06d", code), nil
}

// ValidateTOTP checks code against secret with a 1-step clock skew allowance (-30s, 0s, +30s)
func ValidateTOTP(secretBase32, inputCode string) bool {
	cleanCode := strings.TrimSpace(inputCode)
	if len(cleanCode) != 6 {
		return false
	}

	now := time.Now()
	for _, dt := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		code, err := ComputeTOTP(secretBase32, now.Add(dt))
		if err == nil && code == cleanCode {
			return true
		}
	}
	return false
}

// GenerateRecoveryCodes produces single-use 8-character alphanumeric backup codes
func GenerateRecoveryCodes(count int) []string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // avoid ambiguous characters (0, O, 1, I)
	codes := make([]string, count)
	b := make([]byte, 8)

	for i := 0; i < count; i++ {
		_, _ = rand.Read(b)
		code := make([]byte, 8)
		for j, val := range b {
			code[j] = charset[int(val)%len(charset)]
		}
		// Format as XXXX-XXXX
		codes[i] = fmt.Sprintf("%s-%s", string(code[:4]), string(code[4:]))
	}
	return codes
}

// BuildOTPAuthURI returns standard RFC 6238 URI importable by all Authenticator apps
func BuildOTPAuthURI(email, issuer, secret string) string {
	label := fmt.Sprintf("%s:%s", issuer, email)
	u := url.URL{
		Scheme: "otpauth",
		Host:   "totp",
		Path:   label,
	}
	q := u.Query()
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	u.RawQuery = q.Encode()
	return u.String()
}

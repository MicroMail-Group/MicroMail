package web

import (
	"testing"
	"time"
)

func TestTOTPGenerationAndValidation(t *testing.T) {
	secret := GenerateTOTPSecret()
	if len(secret) == 0 {
		t.Fatalf("expected non-empty TOTP secret")
	}

	now := time.Now()
	code, err := ComputeTOTP(secret, now)
	if err != nil {
		t.Fatalf("failed to compute TOTP: %v", err)
	}

	if len(code) != 6 {
		t.Fatalf("expected 6-digit TOTP code, got: %s", code)
	}

	// Validate code
	if !ValidateTOTP(secret, code) {
		t.Fatalf("expected code %s to be valid for secret %s", code, secret)
	}

	// Invalidate code with wrong digits
	if ValidateTOTP(secret, "000000") && code != "000000" {
		t.Fatalf("expected 000000 to be invalid")
	}

	// Check recovery codes
	recoveryCodes := GenerateRecoveryCodes(5)
	if len(recoveryCodes) != 5 {
		t.Fatalf("expected 5 recovery codes, got %d", len(recoveryCodes))
	}

	// Check OTPAuth URI
	uri := BuildOTPAuthURI("user@grimmdev.fyi", "MicroMail", secret)
	if len(uri) == 0 || uri[:8] != "otpauth:" {
		t.Fatalf("invalid otpauth uri: %s", uri)
	}
}

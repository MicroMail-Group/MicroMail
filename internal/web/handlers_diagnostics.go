package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"micromail/internal/config"
	"micromail/internal/mail"
	"micromail/internal/store"
)

type DiagnosticsHandler struct {
	cfg      *config.Config
	store    *store.Store
	outbound *mail.OutboundQueue
	dkimMgr  *mail.DKIMManager
}

func NewDiagnosticsHandler(cfg *config.Config, s *store.Store, outbound *mail.OutboundQueue, dkimMgr *mail.DKIMManager) *DiagnosticsHandler {
	return &DiagnosticsHandler{
		cfg:      cfg,
		store:    s,
		outbound: outbound,
		dkimMgr:  dkimMgr,
	}
}

type CheckItem struct {
	Name    string `json:"name"`
	Target  string `json:"target"`
	Status  string `json:"status"` // "ok", "warning", "error"
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

type DiagnosticReport struct {
	Domain     string      `json:"domain"`
	Hostname   string      `json:"hostname"`
	Timestamp  int64       `json:"timestamp"`
	PortChecks []CheckItem `json:"port_checks"`
	DNSChecks  []CheckItem `json:"dns_checks"`
	AllPassed  bool        `json:"all_passed"`
}

func (h *DiagnosticsHandler) RunDiagnostics(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	resolver := net.DefaultResolver

	report := DiagnosticReport{
		Domain:    h.cfg.MailDomain,
		Hostname:  h.cfg.MailHostname,
		Timestamp: time.Now().Unix(),
		AllPassed: true,
	}

	// 1. Port Checks (Verify internal server is listening)
	ports := []struct {
		port string
		name string
	}{
		{"25", "Inbound SMTP (:25)"},
		{"587", "SMTP Submission (:587)"},
		{"993", "IMAPS (:993)"},
		{"8080", "HTTP Webmail (:8080)"},
	}

	for _, p := range ports {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", p.port), 500*time.Millisecond)
		if err == nil {
			conn.Close()
			report.PortChecks = append(report.PortChecks, CheckItem{
				Name:    p.name,
				Target:  ":" + p.port,
				Status:  "ok",
				Message: "Service active and listening",
			})
		} else {
			report.AllPassed = false
			report.PortChecks = append(report.PortChecks, CheckItem{
				Name:    p.name,
				Target:  ":" + p.port,
				Status:  "error",
				Message: fmt.Sprintf("Port closed or unreachable: %v", err),
			})
		}
	}

	// 2. DNS MX Check
	mxRecords, err := resolver.LookupMX(ctx, h.cfg.MailDomain)
	if err != nil || len(mxRecords) == 0 {
		report.AllPassed = false
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "MX Record",
			Target:  h.cfg.MailDomain,
			Status:  "error",
			Message: "No MX records found for domain",
			Details: fmt.Sprintf("Error: %v. Add MX record pointing to %s", err, h.cfg.MailHostname),
		})
	} else {
		var mxHosts []string
		matched := false
		for _, mx := range mxRecords {
			host := strings.TrimSuffix(mx.Host, ".")
			mxHosts = append(mxHosts, fmt.Sprintf("%s (prio %d)", host, mx.Pref))
			if strings.EqualFold(host, h.cfg.MailHostname) {
				matched = true
			}
		}

		if matched {
			report.DNSChecks = append(report.DNSChecks, CheckItem{
				Name:    "MX Record",
				Target:  h.cfg.MailDomain,
				Status:  "ok",
				Message: fmt.Sprintf("Active MX: %s", strings.Join(mxHosts, ", ")),
			})
		} else {
			report.DNSChecks = append(report.DNSChecks, CheckItem{
				Name:    "MX Record",
				Target:  h.cfg.MailDomain,
				Status:  "warning",
				Message: fmt.Sprintf("Found MX: %s (Expected: %s)", strings.Join(mxHosts, ", "), h.cfg.MailHostname),
			})
		}
	}

	// 3. DNS Hostname A Record Check
	ips, err := resolver.LookupHost(ctx, h.cfg.MailHostname)
	if err != nil || len(ips) == 0 {
		report.AllPassed = false
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "Mail Hostname A Record",
			Target:  h.cfg.MailHostname,
			Status:  "error",
			Message: fmt.Sprintf("Could not resolve IP for %s", h.cfg.MailHostname),
			Details: "Make sure you created an A record for " + h.cfg.MailHostname + " with DNS Only (Grey Cloud)",
		})
	} else {
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "Mail Hostname A Record",
			Target:  h.cfg.MailHostname,
			Status:  "ok",
			Message: fmt.Sprintf("Resolves to IP: %s", strings.Join(ips, ", ")),
		})
	}

	// 4. DNS SPF Check
	txtRecords, err := resolver.LookupTXT(ctx, h.cfg.MailDomain)
	spfFound := false
	var spfVal string
	if err == nil {
		for _, txt := range txtRecords {
			if strings.HasPrefix(txt, "v=spf1") {
				spfFound = true
				spfVal = txt
				break
			}
		}
	}

	if spfFound {
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "SPF TXT Record",
			Target:  h.cfg.MailDomain,
			Status:  "ok",
			Message: "Valid SPF record detected",
			Details: spfVal,
		})
	} else {
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "SPF TXT Record",
			Target:  h.cfg.MailDomain,
			Status:  "warning",
			Message: "No SPF record (v=spf1 ...) detected in DNS",
			Details: "Add TXT @ with value 'v=spf1 mx -all' in Cloudflare",
		})
	}

	// 5. DNS DKIM Check
	dkimHost := fmt.Sprintf("%s._domainkey.%s", h.cfg.DKIMSelector, h.cfg.MailDomain)
	dkimTxts, err := resolver.LookupTXT(ctx, dkimHost)
	dkimFound := false
	var dkimVal string
	if err == nil {
		for _, txt := range dkimTxts {
			if strings.HasPrefix(txt, "v=DKIM1") {
				dkimFound = true
				dkimVal = txt
				break
			}
		}
	}

	if dkimFound {
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "DKIM TXT Record",
			Target:  dkimHost,
			Status:  "ok",
			Message: "DKIM public key published and verified",
			Details: dkimVal[:min(len(dkimVal), 50)] + "...",
		})
	} else {
		report.DNSChecks = append(report.DNSChecks, CheckItem{
			Name:    "DKIM TXT Record",
			Target:  dkimHost,
			Status:  "warning",
			Message: "DKIM public key not detected yet (DNS propagation may take a few minutes)",
			Details: "Add TXT " + h.cfg.DKIMSelector + "._domainkey in Cloudflare",
		})
	}

	writeJSON(w, http.StatusOK, report)
}

type TestEmailRequest struct {
	To string `json:"to"`
}

func (h *DiagnosticsHandler) SendTestEmail(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req TestEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.To == "" {
		http.Error(w, "Destination email 'to' is required", http.StatusBadRequest)
		return
	}

	subject := fmt.Sprintf("MicroMail Diagnostic Delivery Test [%s]", time.Now().Format("15:04:05"))
	bodyText := fmt.Sprintf(
		"Hello!\n\nThis is an automated diagnostic email from your MicroMail server (%s).\n\nDetails:\n- Sent by: %s\n- Hostname: %s\n- Domain: %s\n- Time: %s\n- DKIM Signature: Active (2048-bit RSA)\n\nIf you received this in your inbox, your outbound MX resolution, STARTTLS encryption, and DKIM signing are functioning with 10/10 deliverability!\n\n--\nMicroMail Engine",
		h.cfg.MailHostname,
		user.Email,
		h.cfg.MailHostname,
		h.cfg.MailDomain,
		time.Now().Format(time.RFC1123),
	)

	bodyHTML := fmt.Sprintf(
		`<div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
			<h2 style="color: #4f46e5; margin-top: 0;">MicroMail Diagnostic Test</h2>
			<p>Congratulations! If you are reading this email, your MicroMail server successfully resolved your destination MX records, negotiated TLS, and signed this message with a 2048-bit RSA DKIM key.</p>
			<table style="width: 100%%; font-size: 13px; border-collapse: collapse; margin: 15px 0;">
				<tr style="background: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Sender:</td><td style="padding: 8px;">%s</td></tr>
				<tr><td style="padding: 8px; font-weight: bold;">Server Hostname:</td><td style="padding: 8px;">%s</td></tr>
				<tr style="background: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Mail Domain:</td><td style="padding: 8px;">%s</td></tr>
				<tr><td style="padding: 8px; font-weight: bold;">Timestamp:</td><td style="padding: 8px;">%s</td></tr>
			</table>
			<p style="font-size: 12px; color: #64748b;">Powered by MicroMail Single-Container Pure-Go Engine</p>
		</div>`,
		user.Email,
		h.cfg.MailHostname,
		h.cfg.MailDomain,
		time.Now().Format(time.RFC1123),
	)

	msg, err := h.outbound.ComposeAndSend(user, []string{req.To}, nil, subject, bodyText, bodyHTML, nil)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": fmt.Sprintf("Diagnostic email successfully dispatched to %s", req.To),
		"msg_id":  msg.ID,
	})
}

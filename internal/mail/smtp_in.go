package mail

import (
	"bytes"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"

	"github.com/emersion/go-msgauth/authres"
	"github.com/emersion/go-msgauth/dkim"
	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
	"micromail/internal/addons"
	"micromail/internal/config"
	"micromail/internal/store"
)

type SMTPServer struct {
	server     *smtp.Server
	cfg        *config.Config
	store      *store.Store
	wasmRunner *addons.WASMRunner
	notifier   Notifier
	outbound   *OutboundQueue
}

type Notifier interface {
	Broadcast(userID, eventType string, data any)
}

type smtpBackend struct {
	server *SMTPServer
}

type smtpSession struct {
	server       *SMTPServer
	from         string
	recipients   []string
	conn         *smtp.Conn
	authUser     *store.User
	isSubmission bool
}

func NewSMTPServer(cfg *config.Config, s *store.Store, runner *addons.WASMRunner, notifier Notifier, outbound *OutboundQueue, isSubmission bool) *SMTPServer {
	srv := &SMTPServer{
		cfg:        cfg,
		store:      s,
		wasmRunner: runner,
		notifier:   notifier,
		outbound:   outbound,
	}

	backend := &smtpBackend{server: srv}
	smtpSrv := smtp.NewServer(backend)
	smtpSrv.Domain = cfg.MailHostname
	smtpSrv.MaxMessageBytes = 25 * 1024 * 1024 // 25 MB max
	smtpSrv.MaxRecipients = 50
	smtpSrv.ReadTimeout = 60 * time.Second
	smtpSrv.WriteTimeout = 60 * time.Second

	if isSubmission {
		smtpSrv.Addr = cfg.SMTPSubmissionAddr
		smtpSrv.AllowInsecureAuth = true // behind internal proxy/wireguard or when TLS terminated
	} else {
		smtpSrv.Addr = cfg.SMTPInAddr
		smtpSrv.AllowInsecureAuth = false
	}

	// Load TLS if configured
	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		if cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile); err == nil {
			smtpSrv.TLSConfig = &tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			}
		} else {
			log.Printf("[SMTP] Warning: Failed to load TLS certs: %v", err)
		}
	}

	srv.server = smtpSrv
	return srv
}

func (s *SMTPServer) Start() error {
	log.Printf("[SMTP] Listening on %s (domain: %s)", s.server.Addr, s.server.Domain)
	return s.server.ListenAndServe()
}

func (s *SMTPServer) Close() error {
	return s.server.Close()
}

func (b *smtpBackend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	return &smtpSession{
		server: b.server,
		conn:   c,
	}, nil
}

// Support AUTH for submissions
func (s *smtpSession) AuthMechanisms() []string {
	return []string{sasl.Plain}
}

func (s *smtpSession) Auth(mech string) (sasl.Server, error) {
	if mech != sasl.Plain {
		return nil, errors.New("unsupported authentication mechanism")
	}

	return sasl.NewPlainServer(func(identity, username, password string) error {
		u, err := s.server.store.AuthenticateUser(username, password)
		if err != nil {
			return errors.New("invalid credentials")
		}
		s.authUser = u
		s.isSubmission = true
		return nil
	}), nil
}

func (s *smtpSession) Mail(from string, opts *smtp.MailOptions) error {
	s.from = strings.Trim(from, "<>")
	s.recipients = nil
	return nil
}

func isSystemRoleAddress(localPart string) bool {
	lp := strings.ToLower(strings.TrimSpace(localPart))
	return lp == "postmaster" || lp == "dmarc" || lp == "tls-rpt" || lp == "abuse" || lp == "hostmaster"
}

func (s *SMTPServer) isLocalDomain(domain string) bool {
	if domain == "" {
		return true // unqualified (e.g. <postmaster>)
	}
	d := strings.ToLower(strings.TrimSpace(domain))
	if s.cfg.MailDomain != "" && d == strings.ToLower(strings.TrimSpace(s.cfg.MailDomain)) {
		return true
	}
	if s.cfg.MailHostname != "" && d == strings.ToLower(strings.TrimSpace(s.cfg.MailHostname)) {
		return true
	}
	if d == "localhost" || d == "127.0.0.1" {
		return true
	}
	return false
}

func (s *SMTPServer) resolveLocalUser(rcpt string) (*store.User, error) {
	clean := strings.Trim(rcpt, "<>")
	clean = strings.TrimSpace(clean)
	parts := strings.Split(clean, "@")
	localPart := strings.ToLower(strings.TrimSpace(parts[0]))

	// 1. Direct match with exact email
	user, err := s.store.GetUserByEmail(clean)
	if err == nil && user != nil {
		return user, nil
	}

	// 2. Direct match with canonical domain appended if unqualified
	if len(parts) == 1 && s.cfg.MailDomain != "" {
		user, err = s.store.GetUserByEmail(localPart + "@" + strings.ToLower(s.cfg.MailDomain))
		if err == nil && user != nil {
			return user, nil
		}
	}

	// 3. System role addresses: postmaster, dmarc, tls-rpt, abuse, hostmaster
	// RFC 5321 Section 4.5.1: postmaster MUST be accepted.
	// System role addresses are strictly isolated to the dedicated postmaster mailbox.
	// They must NEVER be delivered to regular user inboxes or AdminEmail.
	if isSystemRoleAddress(localPart) {
		// Dedicated postmaster on configured domain
		if s.cfg.MailDomain != "" && s.cfg.MailDomain != "localhost" {
			pmEmail := "postmaster@" + strings.ToLower(s.cfg.MailDomain)
			if pm, err := s.store.GetUserByEmail(pmEmail); err == nil && pm != nil {
				return pm, nil
			}
			// Automatically ensure postmaster user exists on configured domain
			if pm, err := s.store.EnsureUser(pmEmail, s.cfg.AdminPassword, "Postmaster System"); err == nil && pm != nil {
				return pm, nil
			}
		}

		// Check if an existing postmaster user exists on any domain
		users, err := s.store.ListUsers()
		if err == nil {
			for _, u := range users {
				if strings.HasPrefix(strings.ToLower(u.Email), "postmaster@") {
					return u, nil
				}
			}
		}

		// Fallback: route to admin if configured, never create postmaster@localhost
		if s.cfg.AdminEmail != "" {
			if admin, err := s.store.GetUserByEmail(s.cfg.AdminEmail); err == nil && admin != nil {
				return admin, nil
			}
		}
	}

	return nil, errors.New("user not found")
}

func (s *smtpSession) Rcpt(to string, opts *smtp.RcptOptions) error {
	cleanTo := strings.Trim(to, "<>")
	cleanTo = strings.TrimSpace(cleanTo)

	// If this is an authenticated submission (port 587/AUTH), the client may send to any external domain
	if s.isSubmission && s.authUser != nil {
		s.recipients = append(s.recipients, cleanTo)
		return nil
	}

	// Inbound connection on port 25: enforce local domain and local recipient validation
	parts := strings.Split(cleanTo, "@")
	var domain string
	if len(parts) > 1 {
		domain = parts[1]
	}

	// 1. Verify destination domain is hosted locally
	if !s.server.isLocalDomain(domain) {
		return &smtp.SMTPError{
			Code:         554,
			EnhancedCode: smtp.EnhancedCode{5, 7, 1},
			Message:      fmt.Sprintf("Relay access denied: domain <%s> is not hosted on this server", domain),
		}
	}

	// 2. Verify mailbox exists locally (or is valid system role address)
	if _, err := s.server.resolveLocalUser(cleanTo); err != nil {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 1, 1},
			Message:      fmt.Sprintf("Mailbox unavailable: recipient <%s> does not exist", cleanTo),
		}
	}

	s.recipients = append(s.recipients, cleanTo)
	return nil
}

func (s *smtpSession) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		return &smtp.SMTPError{
			Code:    451,
			Message: "Error reading message data",
		}
	}

	// If this is an authenticated submission (outgoing email from an authorized user)
	if s.isSubmission && s.authUser != nil {
		if s.server.outbound != nil {
			return s.server.outbound.EnqueueAndSend(s.authUser, s.from, s.recipients, raw)
		}
		return nil
	}

	// Inbound delivery
	return s.server.processInbound(s.from, s.recipients, raw, s.conn)
}

func (s *SMTPServer) processInbound(from string, recipients []string, raw []byte, conn *smtp.Conn) error {
	// Parse MIME
	parsed, err := ParseMIME(raw, s.cfg.DataDir)
	if err != nil {
		log.Printf("[SMTP] MIME parse error: %v", err)
	}

	// Verify DKIM
	var dkimResult authres.ResultValue = authres.ResultNone
	verifications, err := dkim.Verify(bytes.NewReader(raw))
	if err == nil && len(verifications) > 0 {
		hasPass := false
		for _, v := range verifications {
			if v.Err == nil {
				hasPass = true
				break
			}
		}
		if hasPass {
			dkimResult = authres.ResultPass
		} else {
			dkimResult = authres.ResultFail
		}
	}

	// Simple SPF indicator (check if remote host IP reverse matches sender domain)
	spfResult := authres.ResultNone
	if conn != nil {
		if remoteIP, _, err := net.SplitHostPort(conn.Conn().RemoteAddr().String()); err == nil {
			parsed.Headers["X-Originating-IP"] = remoteIP
			spfResult = authres.ResultPass // basic indicator
		}
	}

	parsed.Headers["Authentication-Results"] = fmt.Sprintf("spf=%s; dkim=%s", spfResult, dkimResult)

	var hookAtts []addons.AttachmentData
	for _, a := range parsed.Attachments {
		hookAtts = append(hookAtts, addons.AttachmentData{
			Filename:    a.Filename,
			ContentType: a.ContentType,
			Size:        a.Size,
			Path:        a.Path,
		})
	}

	// Build hook input
	hookEmail := addons.InboundEmailData{
		From:        from,
		To:          recipients,
		Subject:     parsed.Subject,
		Headers:     parsed.Headers,
		BodyText:    parsed.BodyText,
		Attachments: hookAtts,
	}

	// Run backend WASM hooks
	var hookOutput *addons.HookOutput
	if s.wasmRunner != nil {
		out, err := s.wasmRunner.RunInboundPreStoreHook(hookEmail)
		if err != nil {
			log.Printf("[WASM] Error executing pre-store hook: %v", err)
		} else {
			hookOutput = out
		}
	}

	if hookOutput != nil && hookOutput.Action == "reject" {
		return &smtp.SMTPError{
			Code:    550,
			Message: "Message rejected by policy filter",
		}
	}

	// Determine destination folder
	targetFolder := "INBOX"
	spamScore := 0.0
	var tags []string

	if hookOutput != nil {
		spamScore = hookOutput.SpamScore
		tags = hookOutput.Tags
		if hookOutput.Action == "spam" || spamScore >= 0.75 {
			targetFolder = "Spam"
		}
	}

	// Save raw EML blob to disk
	blobRelPath, err := SaveRawEmailBlob(s.cfg.DataDir, raw)
	if err != nil {
		log.Printf("[SMTP] Failed to save raw blob: %v", err)
		blobRelPath = ""
	}

	// Match recipients with local users
	for _, rcpt := range recipients {
		user, err := s.resolveLocalUser(rcpt)
		if err != nil || user == nil {
			log.Printf("[SMTP] Inbound delivery skipped: local recipient <%s> could not be resolved", rcpt)
			continue
		}

		var atts []store.AttachmentMeta
		for _, a := range parsed.Attachments {
			atts = append(atts, store.AttachmentMeta{
				Filename:    a.Filename,
				ContentType: a.ContentType,
				Size:        a.Size,
				Path:        a.Path,
			})
		}

		msg := &store.Message{
			UserID:          user.ID,
			Folder:          targetFolder,
			MessageIDHeader: parsed.MessageIDHeader,
			InReplyTo:       parsed.InReplyTo,
			Sender:          from,
			Recipients:      recipients,
			Subject:         parsed.Subject,
			Snippet:         parsed.Snippet,
			BodyText:        parsed.BodyText,
			BodyHTML:        parsed.BodyHTML,
			RawBlobPath:     blobRelPath,
			Attachments:     atts,
			Tags:            tags,
			SpamScore:       spamScore,
			IsRead:          false,
			CreatedAt:       time.Now().Unix(),
		}

		if err := s.store.CreateMessage(msg); err != nil {
			log.Printf("[SMTP] Error storing message for user %s: %v", user.Email, err)
			continue
		}

		// Broadcast real-time SSE notification
		if s.notifier != nil {
			s.notifier.Broadcast(user.ID, "NEW_MAIL", msg)
		}
	}

	return nil
}

func (s *smtpSession) Reset() {}

func (s *smtpSession) Logout() error {
	return nil
}

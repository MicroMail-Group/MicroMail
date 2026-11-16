package mail

import (
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"micromail/internal/config"
	"micromail/internal/store"
)

type IMAPServer struct {
	server   *imapserver.Server
	opts     *imapserver.Options
	cfg      *config.Config
	store    *store.Store
	listener net.Listener
}

func NewIMAPServer(cfg *config.Config, s *store.Store) *IMAPServer {
	srv := &IMAPServer{
		cfg:   cfg,
		store: s,
	}

	opts := &imapserver.Options{
		NewSession: func(c *imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			sess := &imapSession{
				server: srv,
				store:  s,
			}
			greeting := &imapserver.GreetingData{
				PreAuth: false,
			}
			return sess, greeting, nil
		},
		InsecureAuth: true, // Allow local/unencrypted behind tunnel or if TLS handled
	}

	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		if cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile); err == nil {
			opts.TLSConfig = &tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			}
		}
	}

	srv.opts = opts
	srv.server = imapserver.New(opts)
	return srv
}

func (s *IMAPServer) Start() error {
	var ln net.Listener
	var err error

	// If certificates are present and port is 993, run directly as TLS
	if s.opts.TLSConfig != nil && strings.HasSuffix(s.cfg.IMAPAddr, "993") {
		ln, err = tls.Listen("tcp", s.cfg.IMAPAddr, s.opts.TLSConfig)
	} else {
		ln, err = net.Listen("tcp", s.cfg.IMAPAddr)
	}

	if err != nil {
		return fmt.Errorf("failed to listen on IMAP addr %s: %w", s.cfg.IMAPAddr, err)
	}

	s.listener = ln
	log.Printf("[IMAP] Listening on %s", s.cfg.IMAPAddr)
	return s.server.Serve(ln)
}

func (s *IMAPServer) Close() error {
	if s.listener != nil {
		return s.listener.Close()
	}
	return nil
}

type imapSession struct {
	server   *IMAPServer
	store    *store.Store
	user     *store.User
	selected string
	messages []*store.Message
	mu       sync.Mutex
}

func (s *imapSession) Close() error {
	return nil
}

func (s *imapSession) Login(username, password string) error {
	u, err := s.store.AuthenticateUser(username, password)
	if err != nil {
		return imapserver.ErrAuthFailed
	}
	s.user = u
	return nil
}

func (s *imapSession) Select(mailbox string, options *imap.SelectOptions) (*imap.SelectData, error) {
	if s.user == nil {
		return nil, imapserver.ErrAuthFailed
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	normMailbox := normalizeFolder(mailbox)
	s.selected = normMailbox

	msgs, err := s.store.ListMessages(s.user.ID, normMailbox, 10000, 0)
	if err != nil {
		return nil, err
	}
	s.messages = msgs

	nextUID, err := s.store.NextIMAPUID(s.user.ID, normMailbox)
	if err != nil {
		nextUID = uint32(len(msgs) + 1)
	}

	return &imap.SelectData{
		Flags: []imap.Flag{
			imap.FlagSeen,
			imap.FlagAnswered,
			imap.FlagFlagged,
			imap.FlagDeleted,
			imap.FlagDraft,
		},
		PermanentFlags: []imap.Flag{
			imap.FlagSeen,
			imap.FlagAnswered,
			imap.FlagFlagged,
			imap.FlagDeleted,
			imap.FlagDraft,
		},
		NumMessages: uint32(len(msgs)),
		UIDNext:     imap.UID(nextUID),
		UIDValidity: 1,
	}, nil
}

func (s *imapSession) Unselect() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.selected = ""
	s.messages = nil
	return nil
}

func (s *imapSession) Create(mailbox string, options *imap.CreateOptions) error {
	return nil
}

func (s *imapSession) Delete(mailbox string) error {
	return nil
}

func (s *imapSession) Rename(mailbox, newName string, options *imap.RenameOptions) error {
	return nil
}

func (s *imapSession) Subscribe(mailbox string) error {
	return nil
}

func (s *imapSession) Unsubscribe(mailbox string) error {
	return nil
}

func (s *imapSession) List(w *imapserver.ListWriter, ref string, patterns []string, options *imap.ListOptions) error {
	folders := []string{"INBOX", "Sent", "Drafts", "Spam", "Trash"}
	for _, f := range folders {
		attrs := []imap.MailboxAttr{}
		switch f {
		case "Sent":
			attrs = append(attrs, imap.MailboxAttrSent)
		case "Drafts":
			attrs = append(attrs, imap.MailboxAttrDrafts)
		case "Spam":
			attrs = append(attrs, imap.MailboxAttrJunk)
		case "Trash":
			attrs = append(attrs, imap.MailboxAttrTrash)
		}

		if err := w.WriteList(&imap.ListData{
			Mailbox: f,
			Delim:   '/',
			Attrs:   attrs,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *imapSession) Status(mailbox string, options *imap.StatusOptions) (*imap.StatusData, error) {
	if s.user == nil {
		return nil, imapserver.ErrAuthFailed
	}

	norm := normalizeFolder(mailbox)
	msgs, err := s.store.ListMessages(s.user.ID, norm, 10000, 0)
	if err != nil {
		return nil, err
	}

	numMsgs := uint32(len(msgs))
	var unread uint32
	for _, m := range msgs {
		if !m.IsRead {
			unread++
		}
	}

	nextUID, _ := s.store.NextIMAPUID(s.user.ID, norm)

	return &imap.StatusData{
		Mailbox:     mailbox,
		NumMessages: &numMsgs,
		NumUnseen:   &unread,
		UIDNext:     imap.UID(nextUID),
		UIDValidity: 1,
	}, nil
}

func (s *imapSession) Append(mailbox string, r imap.LiteralReader, options *imap.AppendOptions) (*imap.AppendData, error) {
	if s.user == nil {
		return nil, imapserver.ErrAuthFailed
	}

	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}

	parsed, _ := ParseMIME(raw, s.server.cfg.DataDir)
	blobPath, _ := SaveRawEmailBlob(s.server.cfg.DataDir, raw)

	norm := normalizeFolder(mailbox)
	msg := &store.Message{
		UserID:          s.user.ID,
		Folder:          norm,
		MessageIDHeader: parsed.MessageIDHeader,
		InReplyTo:       parsed.InReplyTo,
		Sender:          parsed.From,
		Recipients:      parsed.To,
		Subject:         parsed.Subject,
		Snippet:         parsed.Snippet,
		BodyText:        parsed.BodyText,
		BodyHTML:        parsed.BodyHTML,
		RawBlobPath:     blobPath,
		IsRead:          true,
		CreatedAt:       time.Now().Unix(),
	}

	if err := s.store.CreateMessage(msg); err != nil {
		return nil, err
	}

	return &imap.AppendData{
		UID:         imap.UID(msg.IMAPUID),
		UIDValidity: 1,
	}, nil
}

func (s *imapSession) Poll(w *imapserver.UpdateWriter, allowExpunge bool) error {
	return nil
}

func (s *imapSession) Idle(w *imapserver.UpdateWriter, stop <-chan struct{}) error {
	<-stop
	return nil
}

func (s *imapSession) Expunge(w *imapserver.ExpungeWriter, uids *imap.UIDSet) error {
	return nil
}

func (s *imapSession) Search(kind imapserver.NumKind, criteria *imap.SearchCriteria, options *imap.SearchOptions) (*imap.SearchData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var allUIDs []imap.UID
	var allSeqs []uint32

	for i, m := range s.messages {
		allUIDs = append(allUIDs, imap.UID(m.IMAPUID))
		allSeqs = append(allSeqs, uint32(i+1))
	}

	if kind == imapserver.NumKindUID {
		return &imap.SearchData{
			All: imap.UIDSetNum(allUIDs...),
		}, nil
	}

	return &imap.SearchData{
		All: imap.SeqSetNum(allSeqs...),
	}, nil
}

func (s *imapSession) Fetch(w *imapserver.FetchWriter, numSet imap.NumSet, options *imap.FetchOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.selected == "" || s.messages == nil {
		return nil
	}

	for i, m := range s.messages {
		seqNum := uint32(i + 1)
		uid := imap.UID(m.IMAPUID)

		var match bool
		switch set := numSet.(type) {
		case imap.SeqSet:
			match = set.Contains(seqNum)
		case imap.UIDSet:
			match = set.Contains(uid)
		default:
			match = true
		}

		if !match {
			continue
		}

		rw := w.CreateMessage(seqNum)
		if options.UID {
			rw.WriteUID(uid)
		}
		if options.Flags {
			var flags []imap.Flag
			if m.IsRead {
				flags = append(flags, imap.FlagSeen)
			}
			rw.WriteFlags(flags)
		}
		if options.InternalDate {
			rw.WriteInternalDate(time.Unix(m.CreatedAt, 0))
		}
		if options.RFC822Size {
			rw.WriteRFC822Size(int64(len(m.BodyText) + len(m.BodyHTML) + 500))
		}

		// Body sections
		for _, bs := range options.BodySection {
			rawBytes := s.loadRawMessage(m)
			sw := rw.WriteBodySection(bs, int64(len(rawBytes)))
			if sw != nil {
				_, _ = sw.Write(rawBytes)
				_ = sw.Close()
			}
		}

		_ = rw.Close()
	}

	return nil
}

func (s *imapSession) Store(w *imapserver.FetchWriter, numSet imap.NumSet, flags *imap.StoreFlags, options *imap.StoreOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, m := range s.messages {
		uid := imap.UID(m.IMAPUID)
		match := false
		switch set := numSet.(type) {
		case imap.UIDSet:
			match = set.Contains(uid)
		default:
			match = true
		}

		if match {
			for _, flag := range flags.Flags {
				if flag == imap.FlagSeen {
					m.IsRead = (flags.Op != imap.StoreFlagsDel)
					_ = s.store.UpdateMessageRead(m.ID, m.IsRead)
				}
			}
		}
	}

	return nil
}

func (s *imapSession) Copy(numSet imap.NumSet, dest string) (*imap.CopyData, error) {
	return nil, nil
}

func (s *imapSession) loadRawMessage(m *store.Message) []byte {
	if m.RawBlobPath != "" {
		absPath := filepath.Join(s.server.cfg.DataDir, "blobs", m.RawBlobPath)
		data, err := os.ReadFile(absPath)
		if err == nil {
			return data
		}
	}

	// Synthesize if raw file missing
	var b strings.Builder
	b.WriteString(fmt.Sprintf("From: %s\r\n", m.Sender))
	b.WriteString(fmt.Sprintf("Subject: %s\r\n", m.Subject))
	b.WriteString(fmt.Sprintf("Date: %s\r\n", time.Unix(m.CreatedAt, 0).Format(time.RFC1123Z)))
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(m.BodyText)
	return []byte(b.String())
}

func normalizeFolder(folder string) string {
	clean := strings.Trim(folder, "\"/")
	switch strings.ToUpper(clean) {
	case "INBOX":
		return "INBOX"
	case "SENT", "SENT MESSAGES", "SENT ITEMS":
		return "Sent"
	case "DRAFTS":
		return "Drafts"
	case "SPAM", "JUNK":
		return "Spam"
	case "TRASH", "BIN", "DELETED", "DELETED ITEMS":
		return "Trash"
	default:
		return clean
	}
}

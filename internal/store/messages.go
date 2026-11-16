package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID                string `json:"id"`
	Email             string `json:"email"`
	PasswordHash      string `json:"-"`
	DisplayName       string `json:"display_name"`
	Signature         string `json:"signature"`
	IsAdmin           bool   `json:"is_admin"`
	CreatedAt         int64  `json:"created_at"`
	TOTPSecret        string `json:"-"`
	TOTPEnabled       bool   `json:"totp_enabled"`
	TOTPRecoveryCodes string `json:"-"`
}

type AttachmentMeta struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Path        string `json:"path"`
}

type Message struct {
	ID              string           `json:"id"`
	UserID          string           `json:"user_id"`
	IMAPUID         uint32           `json:"imap_uid"`
	Folder          string           `json:"folder"`
	ThreadID        string           `json:"thread_id"`
	MessageIDHeader string           `json:"message_id_header"`
	InReplyTo       string           `json:"in_reply_to"`
	Sender          string           `json:"sender"`
	Recipients      []string         `json:"recipients"`
	Subject         string           `json:"subject"`
	Snippet         string           `json:"snippet"`
	BodyText        string           `json:"body_text"`
	BodyHTML        string           `json:"body_html"`
	RawBlobPath     string           `json:"raw_blob_path"`
	Attachments     []AttachmentMeta `json:"attachments"`
	Tags            []string         `json:"tags"`
	SpamScore       float64          `json:"spam_score"`
	IsRead          bool             `json:"is_read"`
	CreatedAt       int64            `json:"created_at"`
}

type ThreadSummary struct {
	ThreadID     string     `json:"thread_id"`
	Subject      string     `json:"subject"`
	Sender       string     `json:"sender"`
	Snippet      string     `json:"snippet"`
	MessageCount int        `json:"message_count"`
	HasUnread    bool       `json:"has_unread"`
	LatestAt     int64      `json:"latest_at"`
	Tags         []string   `json:"tags"`
	Messages     []*Message `json:"messages,omitempty"`
}

// User methods
func (s *Store) EnsureUser(email, plainPassword, displayName string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	user, err := s.getUserByEmailLocked(email)
	if err == nil {
		return user, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	u := &User{
		ID:           uuid.New().String(),
		Email:        strings.ToLower(strings.TrimSpace(email)),
		PasswordHash: string(hash),
		DisplayName:  displayName,
		CreatedAt:    time.Now().Unix(),
	}

	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if count == 0 {
		u.IsAdmin = true
	}
	isAdminInt := 0
	if u.IsAdmin {
		isAdminInt = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO users (id, email, password_hash, display_name, created_at, is_admin)
		VALUES (?, ?, ?, ?, ?, ?)
	`, u.ID, u.Email, u.PasswordHash, u.DisplayName, u.CreatedAt, isAdminInt)
	if err != nil {
		return nil, fmt.Errorf("failed to insert user: %w", err)
	}

	return u, nil
}

func (s *Store) GetUserByEmail(email string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.getUserByEmailLocked(email)
}

func (s *Store) getUserByEmailLocked(email string) (*User, error) {
	row := s.db.QueryRow(`
		SELECT id, email, password_hash, display_name, created_at,
		       COALESCE(totp_secret, ''), COALESCE(totp_enabled, 0), COALESCE(totp_recovery_codes, '[]'),
		       COALESCE(signature, ''), COALESCE(is_admin, 0)
		FROM users WHERE LOWER(email) = LOWER(?)
	`, strings.TrimSpace(email))

	var u User
	var totpEnabledInt, isAdminInt int
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.CreatedAt, &u.TOTPSecret, &totpEnabledInt, &u.TOTPRecoveryCodes, &u.Signature, &isAdminInt)
	if err != nil {
		return nil, err
	}
	u.TOTPEnabled = totpEnabledInt == 1
	u.IsAdmin = isAdminInt == 1
	return &u, nil
}

func (s *Store) GetUserByID(id string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, email, password_hash, display_name, created_at,
		       COALESCE(totp_secret, ''), COALESCE(totp_enabled, 0), COALESCE(totp_recovery_codes, '[]'),
		       COALESCE(signature, ''), COALESCE(is_admin, 0)
		FROM users WHERE id = ?
	`, id)

	var u User
	var totpEnabledInt, isAdminInt int
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.CreatedAt, &u.TOTPSecret, &totpEnabledInt, &u.TOTPRecoveryCodes, &u.Signature, &isAdminInt)
	if err != nil {
		return nil, err
	}
	u.TOTPEnabled = totpEnabledInt == 1
	u.IsAdmin = isAdminInt == 1
	return &u, nil
}

func (s *Store) EnableUserTOTP(userID, secret, recoveryCodesJSON string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		UPDATE users
		SET totp_secret = ?, totp_enabled = 1, totp_recovery_codes = ?
		WHERE id = ?
	`, secret, recoveryCodesJSON, userID)
	return err
}

func (s *Store) DisableUserTOTP(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		UPDATE users
		SET totp_secret = '', totp_enabled = 0, totp_recovery_codes = '[]'
		WHERE id = ?
	`, userID)
	return err
}

func (s *Store) ValidateAndConsumeRecoveryCode(userID, code string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	row := s.db.QueryRow(`SELECT COALESCE(totp_recovery_codes, '[]') FROM users WHERE id = ?`, userID)
	var rawJSON string
	if err := row.Scan(&rawJSON); err != nil {
		return false, err
	}

	var codes []string
	if err := json.Unmarshal([]byte(rawJSON), &codes); err != nil {
		return false, err
	}

	cleanCode := strings.ToUpper(strings.TrimSpace(code))
	foundIndex := -1
	for i, c := range codes {
		if strings.ToUpper(strings.TrimSpace(c)) == cleanCode {
			foundIndex = i
			break
		}
	}

	if foundIndex == -1 {
		return false, nil
	}

	// Remove used recovery code
	codes = append(codes[:foundIndex], codes[foundIndex+1:]...)
	newJSON, _ := json.Marshal(codes)

	_, err := s.db.Exec(`UPDATE users SET totp_recovery_codes = ? WHERE id = ?`, string(newJSON), userID)
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) AuthenticateUser(email, plainPassword string) (*User, error) {
	u, err := s.GetUserByEmail(email)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(plainPassword)); err != nil {
		return nil, fmt.Errorf("invalid password")
	}
	return u, nil
}

func (s *Store) CreateUser(email, plainPassword, displayName string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	if _, err := s.getUserByEmailLocked(cleanEmail); err == nil {
		return nil, fmt.Errorf("user with email %s already exists", cleanEmail)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	u := &User{
		ID:           uuid.New().String(),
		Email:        cleanEmail,
		PasswordHash: string(hash),
		DisplayName:  displayName,
		CreatedAt:    time.Now().Unix(),
	}

	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if count == 0 {
		u.IsAdmin = true
	}
	isAdminInt := 0
	if u.IsAdmin {
		isAdminInt = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO users (id, email, password_hash, display_name, created_at, is_admin)
		VALUES (?, ?, ?, ?, ?, ?)
	`, u.ID, u.Email, u.PasswordHash, u.DisplayName, u.CreatedAt, isAdminInt)
	if err != nil {
		return nil, fmt.Errorf("failed to insert user: %w", err)
	}

	return u, nil
}

func (s *Store) ListUsers() ([]*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, email, display_name, created_at, COALESCE(signature, ''), COALESCE(is_admin, 0)
		FROM users ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		var u User
		var isAdminInt int
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt, &u.Signature, &isAdminInt); err != nil {
			return nil, err
		}
		u.IsAdmin = isAdminInt == 1
		users = append(users, &u)
	}
	return users, nil
}

func (s *Store) SetUserAdmin(userID string, isAdmin bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	isAdminInt := 0
	if isAdmin {
		isAdminInt = 1
	}

	_, err := s.db.Exec(`UPDATE users SET is_admin = ? WHERE id = ?`, isAdminInt, userID)
	return err
}

func (s *Store) SetUserAdminByEmail(email string, isAdmin bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	isAdminInt := 0
	if isAdmin {
		isAdminInt = 1
	}

	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	_, err := s.db.Exec(`UPDATE users SET is_admin = ? WHERE LOWER(email) = ?`, isAdminInt, cleanEmail)
	return err
}

func (s *Store) UpdateUserSettings(userID, displayName, signature string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`UPDATE users SET display_name = ?, signature = ? WHERE id = ?`, displayName, signature, userID)
	return err
}

func (s *Store) VerifyAndChangeUserPassword(userID, currentPassword, newPassword string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var hash string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, userID).Scan(&hash)
	if err != nil {
		return fmt.Errorf("user not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(currentPassword)); err != nil {
		return fmt.Errorf("incorrect current password")
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(newHash), userID)
	return err
}

func (s *Store) DeleteUser(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

func (s *Store) UpdateUserPassword(id, newPassword string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), id)
	return err
}

func (s *Store) CountUsers() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

// Messages methods
func (s *Store) NextIMAPUID(userID, folder string) (uint32, error) {
	var maxUID sql.NullInt64
	err := s.db.QueryRow(`
		SELECT MAX(imap_uid) FROM messages WHERE user_id = ? AND folder = ?
	`, userID, folder).Scan(&maxUID)
	if err != nil {
		return 1, err
	}
	if !maxUID.Valid {
		return 1, nil
	}
	return uint32(maxUID.Int64 + 1), nil
}

func (s *Store) CreateMessage(msg *Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	if msg.CreatedAt == 0 {
		msg.CreatedAt = time.Now().Unix()
	}
	if msg.ThreadID == "" {
		msg.ThreadID = s.resolveThreadIDLocked(msg)
	}
	if msg.Folder == "" {
		msg.Folder = "INBOX"
	}
	if msg.IMAPUID == 0 {
		uid, err := s.NextIMAPUID(msg.UserID, msg.Folder)
		if err != nil {
			return err
		}
		msg.IMAPUID = uid
	}

	recipientsJSON, _ := json.Marshal(msg.Recipients)
	tagsJSON, _ := json.Marshal(msg.Tags)
	attachmentsJSON, _ := json.Marshal(msg.Attachments)

	isReadInt := 0
	if msg.IsRead {
		isReadInt = 1
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO messages (
			id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
			sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
			attachments, tags, spam_score, is_read, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, msg.ID, msg.UserID, msg.IMAPUID, msg.Folder, msg.ThreadID, msg.MessageIDHeader, msg.InReplyTo,
		msg.Sender, string(recipientsJSON), msg.Subject, msg.Snippet, msg.BodyText, msg.BodyHTML,
		msg.RawBlobPath, string(attachmentsJSON), string(tagsJSON), msg.SpamScore, isReadInt, msg.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert message: %w", err)
	}

	// Insert into FTS5 index
	_, _ = tx.Exec(`
		INSERT INTO messages_fts (message_id, subject, sender, body_text)
		VALUES (?, ?, ?, ?)
	`, msg.ID, msg.Subject, msg.Sender, msg.BodyText)

	return tx.Commit()
}

func (s *Store) GetMessageByID(id string) (*Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
		       sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
		       attachments, tags, spam_score, is_read, created_at
		FROM messages WHERE id = ?
	`, id)

	return scanMessage(row)
}

func (s *Store) ListMessages(userID, folder string, limit, offset int) ([]*Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.Query(`
		SELECT id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
		       sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
		       attachments, tags, spam_score, is_read, created_at
		FROM messages
		WHERE user_id = ? AND folder = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, userID, folder, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*Message
	for rows.Next() {
		m, err := scanMessageRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func (s *Store) ListThreads(userID, folder string, limit, offset int) ([]*ThreadSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	// Group messages by thread_id within the folder
	query := `
		SELECT m.thread_id,
		       (SELECT subject FROM messages WHERE thread_id = m.thread_id ORDER BY created_at ASC LIMIT 1) as initial_subject,
		       (SELECT sender FROM messages WHERE thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) as latest_sender,
		       (SELECT snippet FROM messages WHERE thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) as latest_snippet,
		       COUNT(*) as msg_count,
		       SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
		       MAX(created_at) as latest_at,
		       (SELECT tags FROM messages WHERE thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) as latest_tags
		FROM messages m
		WHERE m.user_id = ? AND m.folder = ?
		GROUP BY m.thread_id
		ORDER BY latest_at DESC
		LIMIT ? OFFSET ?
	`

	rows, err := s.db.Query(query, userID, folder, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var threads []*ThreadSummary
	for rows.Next() {
		var ts ThreadSummary
		var unreadCount int
		var tagsJSON string

		err := rows.Scan(
			&ts.ThreadID,
			&ts.Subject,
			&ts.Sender,
			&ts.Snippet,
			&ts.MessageCount,
			&unreadCount,
			&ts.LatestAt,
			&tagsJSON,
		)
		if err != nil {
			return nil, err
		}
		ts.HasUnread = unreadCount > 0
		_ = json.Unmarshal([]byte(tagsJSON), &ts.Tags)
		threads = append(threads, &ts)
	}

	return threads, nil
}

func (s *Store) GetThreadMessages(threadID string) ([]*Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
		       sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
		       attachments, tags, spam_score, is_read, created_at
		FROM messages
		WHERE thread_id = ?
		ORDER BY created_at ASC
	`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*Message
	for rows.Next() {
		m, err := scanMessageRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func (s *Store) GetUserThreadMessages(userID, threadID string) ([]*Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
		       sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
		       attachments, tags, spam_score, is_read, created_at
		FROM messages
		WHERE user_id = ? AND thread_id = ?
		ORDER BY created_at ASC
	`, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*Message
	for rows.Next() {
		m, err := scanMessageRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func (s *Store) SearchMessages(userID, query string, limit int) ([]*Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 30
	}

	// Clean query for FTS5 (escape quotes or match wildcard prefix)
	cleaned := strings.ReplaceAll(query, "\"", "")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return nil, nil
	}
	ftsQuery := fmt.Sprintf("\"%s\"*", cleaned)

	rows, err := s.db.Query(`
		SELECT m.id, m.user_id, m.imap_uid, m.folder, m.thread_id, m.message_id_header, m.in_reply_to,
		       m.sender, m.recipients, m.subject, m.snippet, m.body_text, m.body_html, m.raw_blob_path,
		       m.attachments, m.tags, m.spam_score, m.is_read, m.created_at
		FROM messages_fts f
		JOIN messages m ON f.message_id = m.id
		WHERE m.user_id = ? AND messages_fts MATCH ?
		ORDER BY m.created_at DESC
		LIMIT ?
	`, userID, ftsQuery, limit)
	if err != nil {
		// Fallback to LIKE if FTS syntax had issues
		rows, err = s.db.Query(`
			SELECT id, user_id, imap_uid, folder, thread_id, message_id_header, in_reply_to,
			       sender, recipients, subject, snippet, body_text, body_html, raw_blob_path,
			       attachments, tags, spam_score, is_read, created_at
			FROM messages
			WHERE user_id = ? AND (subject LIKE ? OR sender LIKE ? OR body_text LIKE ?)
			ORDER BY created_at DESC
			LIMIT ?
		`, userID, "%"+cleaned+"%", "%"+cleaned+"%", "%"+cleaned+"%", limit)
		if err != nil {
			return nil, err
		}
	}
	defer rows.Close()

	var result []*Message
	for rows.Next() {
		m, err := scanMessageRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func (s *Store) UpdateMessageRead(id string, isRead bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	val := 0
	if isRead {
		val = 1
	}
	_, err := s.db.Exec(`UPDATE messages SET is_read = ? WHERE id = ?`, val, id)
	return err
}

func (s *Store) UpdateUserMessageRead(userID, id string, isRead bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	val := 0
	if isRead {
		val = 1
	}
	_, err := s.db.Exec(`UPDATE messages SET is_read = ? WHERE id = ? AND user_id = ?`, val, id, userID)
	return err
}

func (s *Store) UpdateUserThreadRead(userID, threadID string, isRead bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	val := 0
	if isRead {
		val = 1
	}
	_, err := s.db.Exec(`UPDATE messages SET is_read = ? WHERE thread_id = ? AND user_id = ?`, val, threadID, userID)
	return err
}

func (s *Store) MoveMessage(id, newFolder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var userID string
	err := s.db.QueryRow(`SELECT user_id FROM messages WHERE id = ?`, id).Scan(&userID)
	if err != nil {
		return err
	}
	return s.moveUserMessageLocked(userID, id, newFolder)
}

func (s *Store) MoveUserMessage(userID, id, newFolder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.moveUserMessageLocked(userID, id, newFolder)
}

func (s *Store) moveUserMessageLocked(userID, id, newFolder string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var curFolder, tagsJSON string
	var spamScore float64
	err = tx.QueryRow(`SELECT folder, tags, spam_score FROM messages WHERE id = ? AND user_id = ?`, id, userID).Scan(&curFolder, &tagsJSON, &spamScore)
	if err != nil {
		return err
	}

	if curFolder == newFolder {
		return nil
	}

	// Compute next IMAP UID in destination folder to satisfy unique constraint: idx_messages_imap_uid(user_id, folder, imap_uid)
	var maxUID sql.NullInt64
	_ = tx.QueryRow(`SELECT MAX(imap_uid) FROM messages WHERE user_id = ? AND folder = ?`, userID, newFolder).Scan(&maxUID)
	nextUID := uint32(1)
	if maxUID.Valid {
		nextUID = uint32(maxUID.Int64 + 1)
	}

	// When recovering a message from Spam to INBOX, reset spam score and remove spam tags
	if strings.EqualFold(curFolder, "Spam") && strings.EqualFold(newFolder, "INBOX") {
		var tags []string
		_ = json.Unmarshal([]byte(tagsJSON), &tags)
		cleanedTags := make([]string, 0, len(tags))
		for _, t := range tags {
			if !strings.EqualFold(t, "spam") {
				cleanedTags = append(cleanedTags, t)
			}
		}
		newTagsJSON, _ := json.Marshal(cleanedTags)
		_, err = tx.Exec(`
			UPDATE messages
			SET folder = ?, imap_uid = ?, spam_score = 0.0, tags = ?
			WHERE id = ? AND user_id = ?
		`, newFolder, nextUID, string(newTagsJSON), id, userID)
	} else {
		_, err = tx.Exec(`
			UPDATE messages
			SET folder = ?, imap_uid = ?
			WHERE id = ? AND user_id = ?
		`, newFolder, nextUID, id, userID)
	}

	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) MoveThread(threadID, newFolder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var userID string
	err := s.db.QueryRow(`SELECT user_id FROM messages WHERE thread_id = ? OR id = ? LIMIT 1`, threadID, threadID).Scan(&userID)
	if err != nil {
		return err
	}
	return s.moveUserThreadLocked(userID, threadID, newFolder)
}

func (s *Store) MoveUserThread(userID, threadID, newFolder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.moveUserThreadLocked(userID, threadID, newFolder)
}

func (s *Store) moveUserThreadLocked(userID, threadID, newFolder string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`
		SELECT id, folder, tags, spam_score
		FROM messages
		WHERE (thread_id = ? OR id = ?) AND user_id = ?
		ORDER BY created_at ASC
	`, threadID, threadID, userID)
	if err != nil {
		return err
	}

	type msgRecord struct {
		id        string
		folder    string
		tagsJSON  string
		spamScore float64
	}
	var msgs []msgRecord
	for rows.Next() {
		var m msgRecord
		if err := rows.Scan(&m.id, &m.folder, &m.tagsJSON, &m.spamScore); err != nil {
			rows.Close()
			return err
		}
		msgs = append(msgs, m)
	}
	rows.Close()

	if len(msgs) == 0 {
		return fmt.Errorf("thread not found: %s", threadID)
	}

	// Compute next sequential IMAP UID in destination folder to satisfy unique constraint
	var maxUID sql.NullInt64
	_ = tx.QueryRow(`SELECT MAX(imap_uid) FROM messages WHERE user_id = ? AND folder = ?`, userID, newFolder).Scan(&maxUID)
	currentUID := uint32(1)
	if maxUID.Valid {
		currentUID = uint32(maxUID.Int64 + 1)
	}

	for _, m := range msgs {
		if m.folder == newFolder {
			continue
		}

		if strings.EqualFold(m.folder, "Spam") && strings.EqualFold(newFolder, "INBOX") {
			var tags []string
			_ = json.Unmarshal([]byte(m.tagsJSON), &tags)
			cleanedTags := make([]string, 0, len(tags))
			for _, t := range tags {
				if !strings.EqualFold(t, "spam") {
					cleanedTags = append(cleanedTags, t)
				}
			}
			newTagsJSON, _ := json.Marshal(cleanedTags)
			_, err = tx.Exec(`
				UPDATE messages
				SET folder = ?, imap_uid = ?, spam_score = 0.0, tags = ?
				WHERE id = ? AND user_id = ?
			`, newFolder, currentUID, string(newTagsJSON), m.id, userID)
		} else {
			_, err = tx.Exec(`
				UPDATE messages
				SET folder = ?, imap_uid = ?
				WHERE id = ? AND user_id = ?
			`, newFolder, currentUID, m.id, userID)
		}

		if err != nil {
			return err
		}
		currentUID++
	}

	return tx.Commit()
}

func (s *Store) DeleteMessage(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`DELETE FROM messages_fts WHERE message_id = ?`, id)
	_, err = tx.Exec(`DELETE FROM messages WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteUserMessage(userID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE id = ? AND user_id = ?)`, id, userID)
	_, err = tx.Exec(`DELETE FROM messages WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteThread(threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)`, threadID)
	_, err = tx.Exec(`DELETE FROM messages WHERE thread_id = ?`, threadID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteUserThread(userID, threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ? AND user_id = ?)`, threadID, userID)
	_, err = tx.Exec(`DELETE FROM messages WHERE thread_id = ? AND user_id = ?`, threadID, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetFolderCounts(userID string) (map[string]int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT folder,
		       SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
		       COUNT(*) as total_count
		FROM messages
		WHERE user_id = ?
		GROUP BY folder
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{
		"INBOX":  0,
		"Sent":   0,
		"Drafts": 0,
		"Spam":   0,
		"Trash":  0,
	}

	for rows.Next() {
		var f string
		var unreadCount, totalCount int
		if err := rows.Scan(&f, &unreadCount, &totalCount); err == nil {
			if f == "INBOX" || f == "Spam" {
				counts[f] = unreadCount
			} else if f == "Drafts" {
				counts[f] = totalCount
			} else {
				counts[f] = unreadCount
			}
		}
	}
	return counts, nil
}

// ResegmentUserMailboxes ensures system emails (postmaster, dmarc, tls-rpt, abuse)
// are strictly routed to the dedicated postmaster user on the configured domain, and scanner probe junk (e.g. troycable, localip)
// is separated and moved out of any user inbox into postmaster Spam.
// It also purges and merges any legacy duplicate postmaster@localhost account into the real domain postmaster.
func (s *Store) ResegmentUserMailboxes(domain, adminEmail string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 1. Determine canonical domain
	canonicalDomain := strings.ToLower(strings.TrimSpace(domain))
	if (canonicalDomain == "" || canonicalDomain == "localhost") && adminEmail != "" {
		parts := strings.Split(strings.ToLower(adminEmail), "@")
		if len(parts) == 2 && parts[1] != "" && parts[1] != "localhost" {
			canonicalDomain = parts[1]
		}
	}

	var pmUser *User
	// Only create/ensure postmaster if a valid domain is present; NEVER create postmaster@localhost.
	if canonicalDomain != "" && canonicalDomain != "localhost" {
		postmasterEmail := "postmaster@" + canonicalDomain
		user, err := s.getUserByEmailLocked(postmasterEmail)
		if err == nil && user != nil {
			pmUser = user
		} else {
			hash, _ := bcrypt.GenerateFromPassword([]byte(uuid.New().String()), bcrypt.DefaultCost)
			u := &User{
				ID:           uuid.New().String(),
				Email:        strings.ToLower(postmasterEmail),
				PasswordHash: string(hash),
				DisplayName:  "Postmaster System",
				CreatedAt:    time.Now().Unix(),
			}
			_, err = s.db.Exec(`
				INSERT INTO users (id, email, password_hash, display_name, created_at)
				VALUES (?, ?, ?, ?, ?)
			`, u.ID, u.Email, u.PasswordHash, u.DisplayName, u.CreatedAt)
			if err == nil {
				pmUser = u
			}
		}
	}

	// 2. Automatic cleanup: If a canonical postmaster exists, migrate messages and delete postmaster@localhost
	legacyPM, _ := s.getUserByEmailLocked("postmaster@localhost")
	if legacyPM != nil {
		if pmUser != nil && legacyPM.ID != pmUser.ID {
			_, _ = s.db.Exec(`UPDATE messages SET user_id = ? WHERE user_id = ?`, pmUser.ID, legacyPM.ID)
			_, _ = s.db.Exec(`DELETE FROM users WHERE id = ?`, legacyPM.ID)
		} else if canonicalDomain != "" && canonicalDomain != "localhost" && pmUser == nil {
			canonicalEmail := "postmaster@" + canonicalDomain
			_, _ = s.db.Exec(`UPDATE users SET email = ? WHERE id = ?`, canonicalEmail, legacyPM.ID)
			legacyPM.Email = canonicalEmail
			pmUser = legacyPM
		}
	}

	if pmUser != nil {
		// 1. Move all postmaster/dmarc/tls-rpt/abuse messages out of non-postmaster user accounts into pmUser
		_, _ = s.db.Exec(`
			UPDATE messages
			SET user_id = ?
			WHERE user_id != ? AND (
				LOWER(recipients) LIKE '%postmaster%'
				OR LOWER(recipients) LIKE '%dmarc%'
				OR LOWER(recipients) LIKE '%tls-rpt%'
				OR LOWER(recipients) LIKE '%abuse%'
				OR LOWER(recipients) LIKE '%hostmaster%'
				OR LOWER(sender) LIKE '%dmarc%'
				OR LOWER(sender) LIKE '%noreply-dmarc-support@google.com%'
				OR LOWER(subject) LIKE '%dmarc%'
				OR LOWER(subject) LIKE '%report domain:%'
			)
		`, pmUser.ID, pmUser.ID)

		// 2. Move scanner probe status notifications (e.g. troycable, localip) to pmUser Spam folder
		_, _ = s.db.Exec(`
			UPDATE messages
			SET user_id = ?, folder = 'Spam'
			WHERE (
				LOWER(subject) LIKE '%smtp status notification%'
				OR LOWER(subject) LIKE '%troycable%'
				OR LOWER(body_text) LIKE '%troycable%'
				OR LOWER(recipients) LIKE '%t_smtp%'
				OR LOWER(recipients) LIKE '%localip%'
			)
		`, pmUser.ID)

		// 3. Resegment messages in admin mailbox that do not belong to admin
		if adminEmail != "" {
			adminUser, err := s.getUserByEmailLocked(adminEmail)
			if err == nil && adminUser != nil && adminUser.ID != pmUser.ID {
				parts := strings.Split(strings.ToLower(adminEmail), "@")
				adminLocal := parts[0]
				_, _ = s.db.Exec(`
					UPDATE messages
					SET user_id = ?, folder = 'Spam'
					WHERE user_id = ?
					  AND LOWER(recipients) NOT LIKE ?
					  AND LOWER(recipients) NOT LIKE ?
				`, pmUser.ID, adminUser.ID, "%"+strings.ToLower(adminEmail)+"%", "%"+adminLocal+"%")
			}
		}
	}

	return nil
}

func scanMessage(row *sql.Row) (*Message, error) {
	var m Message
	var recipientsJSON, tagsJSON, attachmentsJSON string
	var isReadInt int

	err := row.Scan(
		&m.ID, &m.UserID, &m.IMAPUID, &m.Folder, &m.ThreadID, &m.MessageIDHeader, &m.InReplyTo,
		&m.Sender, &recipientsJSON, &m.Subject, &m.Snippet, &m.BodyText, &m.BodyHTML, &m.RawBlobPath,
		&attachmentsJSON, &tagsJSON, &m.SpamScore, &isReadInt, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	m.IsRead = isReadInt == 1
	_ = json.Unmarshal([]byte(recipientsJSON), &m.Recipients)
	_ = json.Unmarshal([]byte(tagsJSON), &m.Tags)
	_ = json.Unmarshal([]byte(attachmentsJSON), &m.Attachments)
	return &m, nil
}

func scanMessageRows(rows *sql.Rows) (*Message, error) {
	var m Message
	var recipientsJSON, tagsJSON, attachmentsJSON string
	var isReadInt int

	err := rows.Scan(
		&m.ID, &m.UserID, &m.IMAPUID, &m.Folder, &m.ThreadID, &m.MessageIDHeader, &m.InReplyTo,
		&m.Sender, &recipientsJSON, &m.Subject, &m.Snippet, &m.BodyText, &m.BodyHTML, &m.RawBlobPath,
		&attachmentsJSON, &tagsJSON, &m.SpamScore, &isReadInt, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	m.IsRead = isReadInt == 1
	_ = json.Unmarshal([]byte(recipientsJSON), &m.Recipients)
	_ = json.Unmarshal([]byte(tagsJSON), &m.Tags)
	_ = json.Unmarshal([]byte(attachmentsJSON), &m.Attachments)
	return &m, nil
}

// CleanSubject normalizes an email subject by removing common reply and forward prefixes.
func CleanSubject(subj string) string {
	s := strings.TrimSpace(subj)
	for {
		lower := strings.ToLower(s)
		if strings.HasPrefix(lower, "re:") {
			s = strings.TrimSpace(s[3:])
		} else if strings.HasPrefix(lower, "fwd:") {
			s = strings.TrimSpace(s[4:])
		} else if strings.HasPrefix(lower, "fw:") {
			s = strings.TrimSpace(s[3:])
		} else if strings.HasPrefix(lower, "[re]") {
			s = strings.TrimSpace(s[4:])
		} else if strings.HasPrefix(lower, "(re)") {
			s = strings.TrimSpace(s[4:])
		} else {
			break
		}
	}
	return strings.TrimSpace(s)
}

func (s *Store) resolveThreadIDLocked(msg *Message) string {
	// 1. Try InReplyTo matching
	if inReplyTo := strings.TrimSpace(msg.InReplyTo); inReplyTo != "" {
		cleaned := strings.Trim(inReplyTo, "<>")
		withBrackets := fmt.Sprintf("<%s>", cleaned)

		var matchedThreadID string
		// Try finding in same user's messages first
		err := s.db.QueryRow(`
			SELECT thread_id FROM messages 
			WHERE (user_id = ? OR ? = '') AND (message_id_header = ? OR message_id_header = ? OR id = ? OR id = ?)
			ORDER BY created_at ASC LIMIT 1
		`, msg.UserID, msg.UserID, inReplyTo, withBrackets, inReplyTo, cleaned).Scan(&matchedThreadID)
		if err == nil && matchedThreadID != "" {
			return matchedThreadID
		}

		// Try finding anywhere across messages (e.g. cross-account conversation on same server)
		err = s.db.QueryRow(`
			SELECT thread_id FROM messages 
			WHERE (message_id_header = ? OR message_id_header = ? OR id = ? OR id = ?)
			ORDER BY created_at ASC LIMIT 1
		`, inReplyTo, withBrackets, inReplyTo, cleaned).Scan(&matchedThreadID)
		if err == nil && matchedThreadID != "" {
			return matchedThreadID
		}
	}

	// 2. Try normalized subject matching with participant overlap
	cleanSubj := CleanSubject(msg.Subject)
	if len(cleanSubj) >= 3 {
		// Look for recent messages for this user within 60 days
		since := msg.CreatedAt - (60 * 86400)
		rows, err := s.db.Query(`
			SELECT id, thread_id, sender, recipients, subject 
			FROM messages 
			WHERE user_id = ? AND created_at >= ?
			ORDER BY created_at DESC LIMIT 50
		`, msg.UserID, since)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var cID, cThreadID, cSender, cRcptsJSON, cSubj string
				if err := rows.Scan(&cID, &cThreadID, &cSender, &cRcptsJSON, &cSubj); err == nil {
					if CleanSubject(cSubj) == cleanSubj {
						var cRcpts []string
						_ = json.Unmarshal([]byte(cRcptsJSON), &cRcpts)
						if hasParticipantOverlap(msg.Sender, msg.Recipients, cSender, cRcpts) {
							return cThreadID
						}
					}
				}
			}
		}
	}

	return msg.ID
}

func hasParticipantOverlap(senderA string, rcptsA []string, senderB string, rcptsB []string) bool {
	norm := func(e string) string {
		e = strings.ToLower(strings.TrimSpace(e))
		if idx := strings.Index(e, "<"); idx != -1 {
			if end := strings.Index(e, ">"); end > idx {
				e = e[idx+1 : end]
			}
		}
		return e
	}

	allA := make(map[string]bool)
	if s := norm(senderA); s != "" {
		allA[s] = true
	}
	for _, r := range rcptsA {
		if nr := norm(r); nr != "" {
			allA[nr] = true
		}
	}

	allB := make(map[string]bool)
	if s := norm(senderB); s != "" {
		allB[s] = true
	}
	for _, r := range rcptsB {
		if nr := norm(r); nr != "" {
			allB[nr] = true
		}
	}

	for k := range allA {
		if allB[k] {
			return true
		}
	}
	return false
}

func (s *Store) RepairThreads() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 1. Link messages via InReplyTo
	rows, err := s.db.Query(`
		SELECT m2.id, m1.thread_id 
		FROM messages m2 
		JOIN messages m1 ON (
			(m1.message_id_header = m2.in_reply_to OR m1.message_id_header = ('<' || m2.in_reply_to || '>') OR m1.id = m2.in_reply_to)
			AND m1.id != m2.id
		)
		WHERE m2.in_reply_to != '' AND m2.thread_id != m1.thread_id
	`)
	if err == nil {
		type pair struct{ id, threadID string }
		var updates []pair
		for rows.Next() {
			var p pair
			if err := rows.Scan(&p.id, &p.threadID); err == nil {
				updates = append(updates, p)
			}
		}
		rows.Close()

		for _, p := range updates {
			_, _ = s.db.Exec(`UPDATE messages SET thread_id = ? WHERE id = ?`, p.threadID, p.id)
		}
	}

	// 2. Link messages via normalized subject and participants for each user
	userRows, err := s.db.Query(`SELECT DISTINCT user_id FROM messages`)
	if err == nil {
		var userIDs []string
		for userRows.Next() {
			var uid string
			if err := userRows.Scan(&uid); err == nil {
				userIDs = append(userIDs, uid)
			}
		}
		userRows.Close()

		for _, uid := range userIDs {
			mRows, err := s.db.Query(`
				SELECT id, thread_id, sender, recipients, subject, created_at 
				FROM messages 
				WHERE user_id = ? 
				ORDER BY created_at ASC
			`, uid)
			if err != nil {
				continue
			}

			type msgInfo struct {
				id, threadID, sender, rcptsJSON, subject string
				createdAt                                int64
				rcpts                                    []string
			}
			var msgs []msgInfo
			for mRows.Next() {
				var m msgInfo
				if err := mRows.Scan(&m.id, &m.threadID, &m.sender, &m.rcptsJSON, &m.subject, &m.createdAt); err == nil {
					_ = json.Unmarshal([]byte(m.rcptsJSON), &m.rcpts)
					msgs = append(msgs, m)
				}
			}
			mRows.Close()

			for i := 0; i < len(msgs); i++ {
				cleanI := CleanSubject(msgs[i].subject)
				if len(cleanI) < 3 {
					continue
				}
				for j := i + 1; j < len(msgs); j++ {
					if msgs[j].createdAt-msgs[i].createdAt > (60 * 86400) {
						break
					}
					cleanJ := CleanSubject(msgs[j].subject)
					if cleanI == cleanJ && msgs[i].threadID != msgs[j].threadID {
						if hasParticipantOverlap(msgs[i].sender, msgs[i].rcpts, msgs[j].sender, msgs[j].rcpts) {
							oldThreadID := msgs[j].threadID
							newThreadID := msgs[i].threadID
							_, _ = s.db.Exec(`UPDATE messages SET thread_id = ? WHERE thread_id = ? AND user_id = ?`, newThreadID, oldThreadID, uid)
							for k := range msgs {
								if msgs[k].threadID == oldThreadID {
									msgs[k].threadID = newThreadID
								}
							}
						}
					}
				}
			}
		}
	}

	return nil
}

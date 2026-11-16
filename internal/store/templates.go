package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

type EmailTemplate struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Name      string `json:"name"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func (s *Store) ListTemplates(userID string) ([]*EmailTemplate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, user_id, name, subject, body, created_at, updated_at
		FROM email_templates
		WHERE user_id = ?
		ORDER BY updated_at DESC, created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query templates: %w", err)
	}
	defer rows.Close()

	var templates []*EmailTemplate
	for rows.Next() {
		var t EmailTemplate
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Subject, &t.Body, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan template: %w", err)
		}
		templates = append(templates, &t)
	}
	if templates == nil {
		templates = make([]*EmailTemplate, 0)
	}
	return templates, nil
}

func (s *Store) CreateTemplate(userID, name, subject, body string) (*EmailTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := "tpl_" + hex.EncodeToString(b)
	now := time.Now().Unix()

	_, err := s.db.Exec(`
		INSERT INTO email_templates (id, user_id, name, subject, body, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, id, userID, name, subject, body, now, now)
	if err != nil {
		return nil, fmt.Errorf("failed to insert template: %w", err)
	}

	return &EmailTemplate{
		ID:        id,
		UserID:    userID,
		Name:      name,
		Subject:   subject,
		Body:      body,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func (s *Store) UpdateTemplate(id, userID, name, subject, body string) (*EmailTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().Unix()
	res, err := s.db.Exec(`
		UPDATE email_templates
		SET name = ?, subject = ?, body = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, name, subject, body, now, id, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to update template: %w", err)
	}

	rowsAff, _ := res.RowsAffected()
	if rowsAff == 0 {
		return nil, fmt.Errorf("template not found or unauthorized")
	}

	return &EmailTemplate{
		ID:        id,
		UserID:    userID,
		Name:      name,
		Subject:   subject,
		Body:      body,
		UpdatedAt: now,
	}, nil
}

func (s *Store) DeleteTemplate(id, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	res, err := s.db.Exec(`
		DELETE FROM email_templates
		WHERE id = ? AND user_id = ?
	`, id, userID)
	if err != nil {
		return fmt.Errorf("failed to delete template: %w", err)
	}

	rowsAff, _ := res.RowsAffected()
	if rowsAff == 0 {
		return fmt.Errorf("template not found or unauthorized")
	}
	return nil
}

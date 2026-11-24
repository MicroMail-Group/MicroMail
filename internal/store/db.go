package store

import (
	"database/sql"
	"embed"
	"fmt"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	db *sql.DB
	mu sync.RWMutex
}

func Open(dataDir string) (*Store, error) {
	dbPath := filepath.Join(dataDir, "mail.db")
	dsn := fmt.Sprintf(
		"%s?_pragma=busy_timeout(10000)"+
			"&_pragma=journal_mode(WAL)"+
			"&_pragma=synchronous(NORMAL)"+
			"&_pragma=mmap_size(268435456)"+
			"&_pragma=cache_size(-64000)"+
			"&_pragma=temp_store(MEMORY)"+
			"&_pragma=wal_autocheckpoint(1000)"+
			"&_pragma=foreign_keys(ON)",
		dbPath,
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Optimize connection pooling for WAL mode
	db.SetMaxOpenConns(1) // modernc sqlite performs best with serialized writer/reader pool or WAL
	db.SetMaxIdleConns(1)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	_ = s.RepairThreads()

	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DB() *sql.DB {
	return s.db
}

func (s *Store) migrate() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	migrationSQL, err := migrationsFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return fmt.Errorf("failed to read 001_init.sql: %w", err)
	}

	if _, err := s.db.Exec(string(migrationSQL)); err != nil {
		return fmt.Errorf("failed to execute migration: %w", err)
	}

	// Safe backward-compatible column addition
	_, _ = s.db.Exec(`ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT DEFAULT '[]'`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN signature TEXT DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`)
	_, _ = s.db.Exec(`UPDATE users SET is_admin = 1 WHERE id IN (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)`)
	_, _ = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`)
	_, _ = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS email_templates (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			subject TEXT NOT NULL,
			body TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`)
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_email_templates_user_id ON email_templates(user_id)`)

	// High-performance secondary indexes for mail threading, fast lookups, and unread counts
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_thread_desc ON messages(thread_id, created_at DESC)`)
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_user_folder_unread ON messages(user_id, folder, is_read)`)
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_msg_id_header ON messages(message_id_header) WHERE message_id_header IS NOT NULL AND message_id_header != ''`)
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to) WHERE in_reply_to IS NOT NULL AND in_reply_to != ''`)

	return nil
}

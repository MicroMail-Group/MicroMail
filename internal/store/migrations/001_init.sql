PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    totp_secret TEXT DEFAULT '',
    totp_enabled INTEGER DEFAULT 0,
    totp_recovery_codes TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    imap_uid INTEGER NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    thread_id TEXT NOT NULL,
    message_id_header TEXT,
    in_reply_to TEXT,
    sender TEXT NOT NULL,
    recipients TEXT NOT NULL,
    subject TEXT,
    snippet TEXT,
    body_text TEXT,
    body_html TEXT,
    raw_blob_path TEXT NOT NULL,
    attachments TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    spam_score REAL DEFAULT 0.0,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_user_folder ON messages(user_id, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_imap_uid ON messages(user_id, folder, imap_uid);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    subject,
    sender,
    body_text
);

CREATE TABLE IF NOT EXISTS addons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    runtime TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at INTEGER NOT NULL
);

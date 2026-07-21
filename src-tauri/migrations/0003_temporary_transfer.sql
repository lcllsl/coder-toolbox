CREATE TABLE IF NOT EXISTS temporary_transfer_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  original_path TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
  size_bytes INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_temporary_transfer_expiry
  ON temporary_transfer_items (is_pinned, expires_at);

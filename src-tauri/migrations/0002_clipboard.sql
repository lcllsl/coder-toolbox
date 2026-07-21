CREATE TABLE IF NOT EXISTS clipboard_items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  text_content TEXT,
  image_path TEXT,
  content_hash TEXT NOT NULL,
  preview_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_copied_at TEXT NOT NULL,
  copy_count INTEGER NOT NULL DEFAULT 1,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_recent
  ON clipboard_items (is_pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_type
  ON clipboard_items (type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_hash
  ON clipboard_items (content_hash, updated_at DESC);

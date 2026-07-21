CREATE TABLE IF NOT EXISTS recent_features (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recent_features_used_at
  ON recent_features (used_at DESC);

CREATE TABLE IF NOT EXISTS vault_metadata (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  vault_version INTEGER NOT NULL,
  salt TEXT NOT NULL,
  kdf_memory_kib INTEGER NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_parallelism INTEGER NOT NULL,
  check_ciphertext TEXT NOT NULL,
  check_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT PRIMARY KEY NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_items_updated_at
  ON vault_items (updated_at DESC);

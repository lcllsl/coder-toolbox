PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reminder_logs (
  id TEXT PRIMARY KEY NOT NULL,
  reminder_id TEXT NOT NULL CHECK (reminder_id IN ('stand', 'water', 'pelvic_floor', 'eye_rest', 'posture')),
  action TEXT NOT NULL CHECK (action IN ('completed', 'snoozed', 'dismissed', 'auto_hidden')),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_occurred_at
  ON reminder_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_reminder_id
  ON reminder_logs (reminder_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS smart_chart_projects (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  chart_count INTEGER NOT NULL,
  kpi_count INTEGER NOT NULL,
  dataset_json TEXT NOT NULL,
  report_spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_chart_projects_updated_at
  ON smart_chart_projects(updated_at DESC);

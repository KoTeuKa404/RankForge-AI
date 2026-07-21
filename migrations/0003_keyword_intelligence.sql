CREATE TABLE IF NOT EXISTS keyword_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  unique_count INTEGER NOT NULL DEFAULT 0,
  cluster_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_keyword_analyses_owner_created
  ON keyword_analyses(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_analyses_project_created
  ON keyword_analyses(project_id, created_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audit_jobs (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  owner_email TEXT,
  project_id TEXT,
  root_url TEXT NOT NULL,
  max_pages INTEGER NOT NULL CHECK(max_pages IN (5, 10, 25)),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  audit_id TEXT,
  report_key TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY(audit_id) REFERENCES audits(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_jobs_owner_updated
  ON audit_jobs(owner_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_jobs_status_updated
  ON audit_jobs(status, updated_at ASC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  root_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_created ON projects(owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  owner_email TEXT NOT NULL,
  root_url TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audits_owner_created ON audits(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_project_created ON audits(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);

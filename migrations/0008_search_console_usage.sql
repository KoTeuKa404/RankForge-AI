PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS search_console_connections (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  site_url TEXT,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_email, project_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gsc_connections_owner ON search_console_connections(owner_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS search_console_snapshots (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  rows_json TEXT NOT NULL,
  opportunities_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_project_created ON search_console_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_owner_created ON search_console_snapshots(owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
  owner_key TEXT NOT NULL,
  period TEXT NOT NULL,
  audit_jobs INTEGER NOT NULL DEFAULT 0,
  ai_fixes INTEGER NOT NULL DEFAULT 0,
  gsc_syncs INTEGER NOT NULL DEFAULT 0,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_key, period)
);

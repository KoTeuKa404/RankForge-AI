CREATE TABLE IF NOT EXISTS internal_link_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  audit_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  root_url TEXT NOT NULL,
  suggestion_count INTEGER NOT NULL DEFAULT 0,
  orphan_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY(audit_id) REFERENCES audits(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_internal_link_owner_created ON internal_link_analyses(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_link_project_created ON internal_link_analyses(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_link_audit ON internal_link_analyses(audit_id);

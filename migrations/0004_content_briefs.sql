CREATE TABLE IF NOT EXISTS content_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  owner_email TEXT NOT NULL,
  source_analysis_id TEXT,
  source_cluster_id TEXT,
  name TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'approved')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY(source_analysis_id) REFERENCES keyword_analyses(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_briefs_owner_updated ON content_briefs(owner_email, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_briefs_project_updated ON content_briefs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_briefs_analysis ON content_briefs(source_analysis_id);

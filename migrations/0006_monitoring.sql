CREATE TABLE IF NOT EXISTS monitoring_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  root_url TEXT NOT NULL,
  max_pages INTEGER NOT NULL DEFAULT 10 CHECK(max_pages IN (5, 10, 25)),
  cadence TEXT NOT NULL DEFAULT 'weekly' CHECK(cadence IN ('daily', 'weekly', 'monthly')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_audit_id TEXT,
  last_status TEXT NOT NULL DEFAULT 'idle' CHECK(last_status IN ('idle', 'running', 'success', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(last_audit_id) REFERENCES audits(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_monitors_owner_updated ON monitoring_configs(owner_email, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitoring_configs(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_monitors_project ON monitoring_configs(project_id);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  audit_id TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
  kind TEXT NOT NULL CHECK(kind IN ('score_drop', 'new_critical', 'new_high', 'crawl_problem', 'recovery')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY(monitor_id) REFERENCES monitoring_configs(id) ON DELETE CASCADE,
  FOREIGN KEY(audit_id) REFERENCES audits(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_owner_created ON monitoring_alerts(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_monitor_created ON monitoring_alerts(monitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_unread ON monitoring_alerts(owner_email, read_at, created_at DESC);

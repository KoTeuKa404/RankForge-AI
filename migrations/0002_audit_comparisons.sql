ALTER TABLE audits ADD COLUMN previous_audit_id TEXT;
ALTER TABLE audits ADD COLUMN score_delta INTEGER;
ALTER TABLE audits ADD COLUMN new_issue_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN fixed_issue_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_audits_previous ON audits(previous_audit_id);

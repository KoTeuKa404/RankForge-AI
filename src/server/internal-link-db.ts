import type { InternalLinkAnalysis, InternalLinkAnalysisSummary } from "../shared/types";

interface Row {
  id: string;
  project_id: string | null;
  audit_id: string;
  root_url: string;
  suggestion_count: number;
  orphan_count: number;
  result_json?: string;
  created_at: string;
}

function summary(row: Row): InternalLinkAnalysisSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    auditId: row.audit_id,
    rootUrl: row.root_url,
    suggestionCount: row.suggestion_count,
    orphanCount: row.orphan_count,
    createdAt: row.created_at,
  };
}

export async function saveInternalLinkAnalysis(db: D1Database, ownerEmail: string, analysis: InternalLinkAnalysis): Promise<void> {
  await db.prepare(
    `INSERT INTO internal_link_analyses
      (id, project_id, audit_id, owner_email, root_url, suggestion_count, orphan_count, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    analysis.id,
    analysis.projectId,
    analysis.auditId,
    ownerEmail,
    analysis.rootUrl,
    analysis.suggestions.length,
    analysis.orphanPages.length,
    JSON.stringify(analysis),
    analysis.createdAt,
  ).run();
}

export async function listInternalLinkAnalyses(db: D1Database, ownerEmail: string, projectId?: string): Promise<InternalLinkAnalysisSummary[]> {
  const columns = "id, project_id, audit_id, root_url, suggestion_count, orphan_count, created_at";
  const result = projectId
    ? await db.prepare(`SELECT ${columns} FROM internal_link_analyses WHERE owner_email = ? AND project_id = ? ORDER BY created_at DESC LIMIT 30`).bind(ownerEmail, projectId).all<Row>()
    : await db.prepare(`SELECT ${columns} FROM internal_link_analyses WHERE owner_email = ? ORDER BY created_at DESC LIMIT 30`).bind(ownerEmail).all<Row>();
  return (result.results || []).map(summary);
}

export async function getInternalLinkAnalysis(db: D1Database, ownerEmail: string, id: string): Promise<InternalLinkAnalysis | null> {
  const row = await db.prepare("SELECT result_json FROM internal_link_analyses WHERE id = ? AND owner_email = ? LIMIT 1")
    .bind(id, ownerEmail).first<{ result_json: string }>();
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as InternalLinkAnalysis;
  } catch {
    return null;
  }
}

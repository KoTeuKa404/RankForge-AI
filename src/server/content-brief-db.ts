import type { ContentBrief, ContentBriefSummary } from "../shared/types";

interface ContentBriefRow {
  id: string;
  project_id: string | null;
  name: string;
  primary_keyword: string;
  status: ContentBrief["status"];
  result_json?: string;
  updated_at: string;
}

function parseBrief(raw?: string): ContentBrief | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ContentBrief;
  } catch {
    return null;
  }
}

function summaryFromRow(row: ContentBriefRow): ContentBriefSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    primaryKeyword: row.primary_keyword,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function saveContentBrief(db: D1Database, ownerEmail: string, brief: ContentBrief): Promise<void> {
  await db.prepare(
    `INSERT INTO content_briefs
      (id, project_id, owner_email, source_analysis_id, source_cluster_id, name, primary_keyword, status, result_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    brief.id,
    brief.projectId,
    ownerEmail,
    brief.sourceAnalysisId,
    brief.sourceClusterId,
    brief.name,
    brief.primaryKeyword,
    brief.status,
    JSON.stringify(brief),
    brief.createdAt,
    brief.updatedAt,
  ).run();
}

export async function updateContentBrief(db: D1Database, ownerEmail: string, brief: ContentBrief): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE content_briefs
     SET name = ?, primary_keyword = ?, status = ?, result_json = ?, updated_at = ?
     WHERE id = ? AND owner_email = ?`,
  ).bind(
    brief.name,
    brief.primaryKeyword,
    brief.status,
    JSON.stringify(brief),
    brief.updatedAt,
    brief.id,
    ownerEmail,
  ).run();
  return Number(result.meta.changes || 0) > 0;
}

export async function listContentBriefs(db: D1Database, ownerEmail: string, projectId?: string): Promise<ContentBriefSummary[]> {
  const columns = "id, project_id, name, primary_keyword, status, updated_at";
  const result = projectId
    ? await db.prepare(`SELECT ${columns} FROM content_briefs WHERE owner_email = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 50`)
      .bind(ownerEmail, projectId).all<ContentBriefRow>()
    : await db.prepare(`SELECT ${columns} FROM content_briefs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 50`)
      .bind(ownerEmail).all<ContentBriefRow>();
  return (result.results || []).map(summaryFromRow);
}

export async function getContentBrief(db: D1Database, ownerEmail: string, id: string): Promise<ContentBrief | null> {
  const row = await db.prepare("SELECT result_json FROM content_briefs WHERE id = ? AND owner_email = ? LIMIT 1")
    .bind(id, ownerEmail)
    .first<{ result_json: string }>();
  return parseBrief(row?.result_json);
}

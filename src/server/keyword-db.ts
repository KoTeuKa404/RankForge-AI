import type { KeywordAnalysis, KeywordAnalysisSummary } from "../shared/types";

interface KeywordAnalysisRow {
  id: string;
  project_id: string | null;
  name: string;
  input_count: number;
  unique_count: number;
  cluster_count: number;
  result_json?: string;
  created_at: string;
}

function summaryFromRow(row: KeywordAnalysisRow): KeywordAnalysisSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    inputCount: row.input_count,
    uniqueCount: row.unique_count,
    clusterCount: row.cluster_count,
    createdAt: row.created_at,
  };
}

export async function saveKeywordAnalysis(db: D1Database, ownerEmail: string, analysis: KeywordAnalysis): Promise<void> {
  await db.prepare(
    `INSERT INTO keyword_analyses
      (id, project_id, owner_email, name, input_count, unique_count, cluster_count, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    analysis.id,
    analysis.projectId,
    ownerEmail,
    analysis.name,
    analysis.inputCount,
    analysis.uniqueCount,
    analysis.clusters.length,
    JSON.stringify(analysis),
    analysis.createdAt,
  ).run();
}

export async function listKeywordAnalyses(db: D1Database, ownerEmail: string, projectId?: string): Promise<KeywordAnalysisSummary[]> {
  const columns = "id, project_id, name, input_count, unique_count, cluster_count, created_at";
  const result = projectId
    ? await db.prepare(`SELECT ${columns} FROM keyword_analyses WHERE owner_email = ? AND project_id = ? ORDER BY created_at DESC LIMIT 30`)
      .bind(ownerEmail, projectId).all<KeywordAnalysisRow>()
    : await db.prepare(`SELECT ${columns} FROM keyword_analyses WHERE owner_email = ? ORDER BY created_at DESC LIMIT 30`)
      .bind(ownerEmail).all<KeywordAnalysisRow>();
  return (result.results || []).map(summaryFromRow);
}

export async function getKeywordAnalysis(db: D1Database, ownerEmail: string, id: string): Promise<KeywordAnalysis | null> {
  const row = await db.prepare("SELECT result_json FROM keyword_analyses WHERE id = ? AND owner_email = ? LIMIT 1")
    .bind(id, ownerEmail)
    .first<{ result_json: string }>();
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as KeywordAnalysis;
  } catch {
    return null;
  }
}

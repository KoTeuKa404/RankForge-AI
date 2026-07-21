import type { AuditResult, AuditSummary, Project } from "../shared/types";

interface ProjectRow {
  id: string;
  name: string;
  root_url: string;
  created_at: string;
}

interface AuditRow {
  id: string;
  project_id: string | null;
  root_url: string;
  score: number;
  pages_scanned: number;
  issue_count: number;
  created_at: string;
  result_json?: string;
  previous_audit_id?: string | null;
  score_delta?: number | null;
  new_issue_count?: number | null;
  fixed_issue_count?: number | null;
}

function projectFromRow(row: ProjectRow): Project {
  return { id: row.id, name: row.name, rootUrl: row.root_url, createdAt: row.created_at };
}

function summaryFromRow(row: AuditRow): AuditSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    rootUrl: row.root_url,
    score: row.score,
    pagesScanned: row.pages_scanned,
    issueCount: row.issue_count,
    createdAt: row.created_at,
    previousAuditId: row.previous_audit_id || null,
    scoreDelta: row.score_delta ?? null,
    newIssueCount: row.new_issue_count || 0,
    fixedIssueCount: row.fixed_issue_count || 0,
  };
}

function parseAuditJson(raw?: string): AuditResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuditResult;
  } catch {
    return null;
  }
}

export async function listProjects(db: D1Database, ownerEmail: string): Promise<Project[]> {
  const result = await db.prepare(
    "SELECT id, name, root_url, created_at FROM projects WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100",
  ).bind(ownerEmail).all<ProjectRow>();
  return (result.results || []).map(projectFromRow);
}

export async function createProject(db: D1Database, ownerEmail: string, name: string, rootUrl: string): Promise<Project> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO projects (id, owner_email, name, root_url, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, ownerEmail, name, rootUrl, createdAt).run();
  return { id, name, rootUrl, createdAt };
}

export async function userOwnsProject(db: D1Database, ownerEmail: string, projectId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS found FROM projects WHERE id = ? AND owner_email = ? LIMIT 1")
    .bind(projectId, ownerEmail)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function saveAudit(db: D1Database, ownerEmail: string, projectId: string | null, result: AuditResult): Promise<void> {
  await db.prepare(
    `INSERT INTO audits
      (id, project_id, owner_email, root_url, score, pages_scanned, issue_count, result_json, created_at,
       previous_audit_id, score_delta, new_issue_count, fixed_issue_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    result.id,
    projectId,
    ownerEmail,
    result.rootUrl,
    result.score,
    result.pagesScanned,
    result.issues.length,
    JSON.stringify(result),
    result.finishedAt,
    result.comparison?.previousAuditId || null,
    result.comparison?.scoreDelta ?? null,
    result.comparison?.newIssues.length || 0,
    result.comparison?.fixedIssues.length || 0,
  ).run();
}

export async function listAudits(db: D1Database, ownerEmail: string, projectId?: string): Promise<AuditSummary[]> {
  const columns = `id, project_id, root_url, score, pages_scanned, issue_count, created_at,
    previous_audit_id, score_delta, new_issue_count, fixed_issue_count`;
  const query = projectId
    ? `SELECT ${columns} FROM audits WHERE owner_email = ? AND project_id = ? ORDER BY created_at DESC LIMIT 50`
    : `SELECT ${columns} FROM audits WHERE owner_email = ? ORDER BY created_at DESC LIMIT 50`;
  const statement = db.prepare(query);
  const result = projectId
    ? await statement.bind(ownerEmail, projectId).all<AuditRow>()
    : await statement.bind(ownerEmail).all<AuditRow>();
  return (result.results || []).map(summaryFromRow);
}

export async function getAudit(db: D1Database, ownerEmail: string, auditId: string): Promise<AuditResult | null> {
  const row = await db.prepare("SELECT result_json FROM audits WHERE id = ? AND owner_email = ? LIMIT 1")
    .bind(auditId, ownerEmail)
    .first<{ result_json: string }>();
  return parseAuditJson(row?.result_json);
}

export async function getLatestComparableAudit(
  db: D1Database,
  ownerEmail: string,
  projectId: string | null,
  rootUrl: string,
): Promise<AuditResult | null> {
  const row = projectId
    ? await db.prepare(
      "SELECT result_json FROM audits WHERE owner_email = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(ownerEmail, projectId).first<{ result_json: string }>()
    : await db.prepare(
      "SELECT result_json FROM audits WHERE owner_email = ? AND project_id IS NULL AND root_url = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(ownerEmail, rootUrl).first<{ result_json: string }>();
  return parseAuditJson(row?.result_json);
}

export async function consumeRateLimit(db: D1Database | undefined, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!db) return true;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const composite = `${key}:${windowStart}`;

  await db.prepare(
    `INSERT INTO rate_limits (key, count, expires_at)
     VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1`,
  ).bind(composite, windowStart + windowSeconds).run();

  const row = await db.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(composite).first<{ count: number }>();
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
  }
  return (row?.count || 0) <= limit;
}

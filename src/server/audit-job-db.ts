import type { AuditJob, AuditResult } from "../shared/types";

interface AuditJobRow {
  id: string;
  owner_key: string;
  owner_email: string | null;
  project_id: string | null;
  root_url: string;
  max_pages: number;
  status: AuditJob["status"];
  progress: number;
  pages_scanned: number;
  attempts: number;
  audit_id: string | null;
  report_key: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface StoredAuditJob extends AuditJob {
  ownerKey: string;
  ownerEmail: string | null;
  projectId: string | null;
}

function parseResult(raw: string | null): AuditResult | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AuditResult;
  } catch {
    return undefined;
  }
}

function fromRow(row: AuditJobRow): StoredAuditJob {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    ownerEmail: row.owner_email,
    projectId: row.project_id,
    rootUrl: row.root_url,
    maxPages: row.max_pages,
    status: row.status,
    progress: row.progress,
    pagesScanned: row.pages_scanned,
    attempts: row.attempts,
    auditId: row.audit_id || undefined,
    reportKey: row.report_key || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    finishedAt: row.finished_at || undefined,
    audit: parseResult(row.result_json),
  };
}

const JOB_COLUMNS = `id, owner_key, owner_email, project_id, root_url, max_pages, status,
  progress, pages_scanned, attempts, audit_id, report_key, result_json, error,
  created_at, updated_at, started_at, finished_at`;

export function calculateAuditJobProgress(pagesScanned: number, maxPages: number): number {
  const safePages = Math.max(0, pagesScanned);
  const safeMax = Math.max(1, maxPages);
  return Math.max(5, Math.min(95, Math.round((safePages / safeMax) * 90) + 5));
}

export async function createAuditJob(
  db: D1Database,
  input: {
    ownerKey: string;
    ownerEmail: string | null;
    projectId: string | null;
    rootUrl: string;
    maxPages: number;
  },
): Promise<StoredAuditJob> {
  const now = new Date().toISOString();
  const job: StoredAuditJob = {
    id: crypto.randomUUID(),
    ownerKey: input.ownerKey,
    ownerEmail: input.ownerEmail,
    projectId: input.projectId,
    rootUrl: input.rootUrl,
    maxPages: input.maxPages,
    status: "queued",
    progress: 0,
    pagesScanned: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.prepare(
    `INSERT INTO audit_jobs
      (id, owner_key, owner_email, project_id, root_url, max_pages, status, progress,
       pages_scanned, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 0, 0, ?, ?)`,
  ).bind(
    job.id,
    job.ownerKey,
    job.ownerEmail,
    job.projectId,
    job.rootUrl,
    job.maxPages,
    now,
    now,
  ).run();

  return job;
}

export async function getAuditJob(db: D1Database, ownerKey: string, id: string): Promise<StoredAuditJob | null> {
  const row = await db.prepare(`SELECT ${JOB_COLUMNS} FROM audit_jobs WHERE id = ? AND owner_key = ? LIMIT 1`)
    .bind(id, ownerKey)
    .first<AuditJobRow>();
  return row ? fromRow(row) : null;
}

export async function claimAuditJob(db: D1Database, ownerKey: string, id: string): Promise<StoredAuditJob | null> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE audit_jobs
     SET status = 'running', progress = CASE WHEN progress < 1 THEN 1 ELSE progress END,
         attempts = attempts + 1, error = NULL, started_at = COALESCE(started_at, ?),
         finished_at = NULL, updated_at = ?
     WHERE id = ? AND owner_key = ? AND status IN ('queued', 'failed') AND attempts < 3`,
  ).bind(now, now, id, ownerKey).run();
  if (!result.meta.changes) return null;
  return getAuditJob(db, ownerKey, id);
}

export async function updateAuditJobProgress(
  db: D1Database,
  ownerKey: string,
  id: string,
  pagesScanned: number,
  maxPages: number,
): Promise<void> {
  const progress = calculateAuditJobProgress(pagesScanned, maxPages);
  await db.prepare(
    `UPDATE audit_jobs
     SET pages_scanned = ?, progress = ?, updated_at = ?
     WHERE id = ? AND owner_key = ? AND status = 'running'`,
  ).bind(Math.max(0, pagesScanned), progress, new Date().toISOString(), id, ownerKey).run();
}

export async function heartbeatAuditJob(
  db: D1Database,
  ownerKey: string,
  id: string,
  progress: number,
): Promise<void> {
  await db.prepare(
    `UPDATE audit_jobs
     SET progress = CASE WHEN progress < ? THEN ? ELSE progress END, updated_at = ?
     WHERE id = ? AND owner_key = ? AND status = 'running'`,
  ).bind(
    Math.max(5, Math.min(90, progress)),
    Math.max(5, Math.min(90, progress)),
    new Date().toISOString(),
    id,
    ownerKey,
  ).run();
}

export async function completeAuditJob(
  db: D1Database,
  ownerKey: string,
  id: string,
  result: AuditResult,
  reportKey?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE audit_jobs
     SET status = 'completed', progress = 100, pages_scanned = ?, audit_id = ?,
         report_key = ?, result_json = ?, error = NULL, updated_at = ?, finished_at = ?
     WHERE id = ? AND owner_key = ?`,
  ).bind(
    result.pagesScanned,
    result.id,
    reportKey || null,
    JSON.stringify(result),
    now,
    now,
    id,
    ownerKey,
  ).run();
}

export async function failAuditJob(db: D1Database, ownerKey: string, id: string, error: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE audit_jobs
     SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
     WHERE id = ? AND owner_key = ?`,
  ).bind(error.slice(0, 2_000), now, now, id, ownerKey).run();
}

export async function resetAuditJob(db: D1Database, ownerKey: string, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE audit_jobs
     SET status = 'queued', progress = 0, pages_scanned = 0, error = NULL,
         result_json = NULL, audit_id = NULL, report_key = NULL, updated_at = ?,
         started_at = NULL, finished_at = NULL
     WHERE id = ? AND owner_key = ? AND status = 'failed' AND attempts < 3`,
  ).bind(now, id, ownerKey).run();
  return Boolean(result.meta.changes);
}

import type { AuditJob, AuditJobPhase, AuditResult } from "../shared/types";

interface AuditJobRow {
  id: string;
  owner_key: string;
  owner_email: string | null;
  project_id: string | null;
  root_url: string;
  max_pages: number;
  status: AuditJob["status"];
  phase: AuditJobPhase | null;
  current_url: string | null;
  queued_urls: number;
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
  toJSON(): AuditJob;
}

export interface AuditJobProgressInput {
  phase: AuditJobPhase;
  currentUrl?: string;
  queuedUrls: number;
  pagesScanned: number;
  maxPages: number;
}

const STALE_RUNNING_MS = 5 * 60_000;

function parseResult(raw: string | null): AuditResult | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AuditResult;
  } catch {
    return undefined;
  }
}

function publicJob(job: StoredAuditJob): AuditJob {
  return {
    id: job.id,
    rootUrl: job.rootUrl,
    maxPages: job.maxPages,
    status: job.status,
    phase: job.phase,
    currentUrl: job.currentUrl,
    queuedUrls: job.queuedUrls,
    progress: job.progress,
    pagesScanned: job.pagesScanned,
    attempts: job.attempts,
    auditId: job.auditId,
    reportKey: job.reportKey,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    audit: job.audit,
  };
}

function fromRow(row: AuditJobRow): StoredAuditJob {
  const job = {
    id: row.id,
    ownerKey: row.owner_key,
    ownerEmail: row.owner_email,
    projectId: row.project_id,
    rootUrl: row.root_url,
    maxPages: row.max_pages,
    status: row.status,
    phase: row.phase || undefined,
    currentUrl: row.current_url || undefined,
    queuedUrls: row.queued_urls || 0,
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
    toJSON(): AuditJob { return publicJob(this); },
  } satisfies StoredAuditJob;
  return job;
}

const JOB_COLUMNS = `id, owner_key, owner_email, project_id, root_url, max_pages, status,
  phase, current_url, queued_urls, progress, pages_scanned, attempts, audit_id,
  report_key, result_json, error, created_at, updated_at, started_at, finished_at`;

export function calculateAuditJobProgress(pagesScanned: number, maxPages: number, phase: AuditJobPhase = "crawling"): number {
  const safePages = Math.max(0, pagesScanned);
  const safeMax = Math.max(1, maxPages);
  if (phase === "discovering") return 5;
  if (phase === "finalizing") return 95;
  return Math.max(8, Math.min(92, Math.round((safePages / safeMax) * 84) + 8));
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
  const job = {
    id: crypto.randomUUID(),
    ownerKey: input.ownerKey,
    ownerEmail: input.ownerEmail,
    projectId: input.projectId,
    rootUrl: input.rootUrl,
    maxPages: input.maxPages,
    status: "queued" as const,
    phase: undefined,
    currentUrl: undefined,
    queuedUrls: 0,
    progress: 0,
    pagesScanned: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    toJSON(): AuditJob { return publicJob(this); },
  } satisfies StoredAuditJob;

  await db.prepare(
    `INSERT INTO audit_jobs
      (id, owner_key, owner_email, project_id, root_url, max_pages, status, queued_urls,
       progress, pages_scanned, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 0, 0, 0, ?, ?)`,
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

async function recoverStaleRunningJob(db: D1Database, ownerKey: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  await db.prepare(
    `UPDATE audit_jobs
     SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
     WHERE id = ? AND owner_key = ? AND status = 'running' AND updated_at < ?`,
  ).bind(
    "The background Worker stopped before completion. Retry this audit job.",
    now,
    now,
    id,
    ownerKey,
    staleBefore,
  ).run();
}

export async function getAuditJob(db: D1Database, ownerKey: string, id: string): Promise<StoredAuditJob | null> {
  await recoverStaleRunningJob(db, ownerKey, id);
  const row = await db.prepare(`SELECT ${JOB_COLUMNS} FROM audit_jobs WHERE id = ? AND owner_key = ? LIMIT 1`)
    .bind(id, ownerKey)
    .first<AuditJobRow>();
  return row ? fromRow(row) : null;
}

export async function claimAuditJob(db: D1Database, ownerKey: string, id: string): Promise<StoredAuditJob | null> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE audit_jobs
     SET status = 'running', phase = 'discovering', progress = 5,
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
  input: AuditJobProgressInput,
): Promise<void> {
  const progress = calculateAuditJobProgress(input.pagesScanned, input.maxPages, input.phase);
  await db.prepare(
    `UPDATE audit_jobs
     SET phase = ?, current_url = ?, queued_urls = ?, pages_scanned = ?, progress = ?, updated_at = ?
     WHERE id = ? AND owner_key = ? AND status = 'running'`,
  ).bind(
    input.phase,
    input.currentUrl?.slice(0, 2_000) || null,
    Math.max(0, input.queuedUrls),
    Math.max(0, input.pagesScanned),
    progress,
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
     SET status = 'completed', phase = 'finalizing', progress = 100, pages_scanned = ?,
         queued_urls = 0, current_url = NULL, audit_id = ?, report_key = ?, result_json = ?,
         error = NULL, updated_at = ?, finished_at = ?
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
     SET status = 'queued', phase = NULL, current_url = NULL, queued_urls = 0,
         progress = 0, pages_scanned = 0, error = NULL, result_json = NULL,
         audit_id = NULL, report_key = NULL, updated_at = ?, started_at = NULL,
         finished_at = NULL
     WHERE id = ? AND owner_key = ? AND status = 'failed' AND attempts < 3`,
  ).bind(now, id, ownerKey).run();
  return Boolean(result.meta.changes);
}

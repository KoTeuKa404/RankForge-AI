import type { UsageSummary } from "../shared/search-console";
import type { Env } from "./env";
import { TargetValidationError } from "./security";

export type UsageMetric = "audit_jobs" | "ai_fixes" | "gsc_syncs" | "pages_crawled";

function period(): string {
  return new Date().toISOString().slice(0, 7);
}

function positiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function usageLimits(env: Env): UsageSummary["limits"] {
  return {
    auditJobs: positiveLimit(env.MONTHLY_AUDIT_LIMIT, 100),
    aiFixes: positiveLimit(env.MONTHLY_AI_FIX_LIMIT, 250),
    gscSyncs: positiveLimit(env.MONTHLY_GSC_SYNC_LIMIT, 40),
    pagesCrawled: positiveLimit(env.MONTHLY_PAGE_LIMIT, 2_500),
  };
}

function metricLimit(metric: UsageMetric, limits: UsageSummary["limits"]): number {
  if (metric === "audit_jobs") return limits.auditJobs;
  if (metric === "ai_fixes") return limits.aiFixes;
  if (metric === "gsc_syncs") return limits.gscSyncs;
  return limits.pagesCrawled;
}

export async function readUsage(db: D1Database, env: Env, ownerKey: string): Promise<UsageSummary> {
  const current = period();
  const row = await db.prepare(
    `SELECT audit_jobs, ai_fixes, gsc_syncs, pages_crawled
     FROM usage_counters WHERE owner_key = ? AND period = ? LIMIT 1`,
  ).bind(ownerKey, current).first<{
    audit_jobs: number;
    ai_fixes: number;
    gsc_syncs: number;
    pages_crawled: number;
  }>();
  return {
    period: current,
    auditJobs: row?.audit_jobs || 0,
    aiFixes: row?.ai_fixes || 0,
    gscSyncs: row?.gsc_syncs || 0,
    pagesCrawled: row?.pages_crawled || 0,
    limits: usageLimits(env),
  };
}

export async function assertAndIncrementUsage(
  db: D1Database,
  env: Env,
  ownerKey: string,
  metric: UsageMetric,
  amount = 1,
): Promise<UsageSummary> {
  const safeAmount = Math.max(1, Math.floor(amount));
  const limits = usageLimits(env);
  const current = await readUsage(db, env, ownerKey);
  const currentValue = metric === "audit_jobs"
    ? current.auditJobs
    : metric === "ai_fixes"
      ? current.aiFixes
      : metric === "gsc_syncs"
        ? current.gscSyncs
        : current.pagesCrawled;
  if (currentValue + safeAmount > metricLimit(metric, limits)) {
    throw new TargetValidationError(`Monthly ${metric.replace(/_/g, " ")} limit reached.`);
  }

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO usage_counters
      (owner_key, period, audit_jobs, ai_fixes, gsc_syncs, pages_crawled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_key, period) DO UPDATE SET
       ${metric} = ${metric} + excluded.${metric},
       updated_at = excluded.updated_at`,
  ).bind(
    ownerKey,
    period(),
    metric === "audit_jobs" ? safeAmount : 0,
    metric === "ai_fixes" ? safeAmount : 0,
    metric === "gsc_syncs" ? safeAmount : 0,
    metric === "pages_crawled" ? safeAmount : 0,
    now,
  ).run();
  return readUsage(db, env, ownerKey);
}

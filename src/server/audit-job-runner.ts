import { auditSite } from "./audit";
import { compareAudits } from "./compare";
import { getLatestComparableAudit, saveAudit } from "./db";
import type { Env } from "./env";
import {
  claimAuditJob,
  completeAuditJob,
  failAuditJob,
  heartbeatAuditJob,
  updateAuditJobProgress,
} from "./audit-job-db";

function reportKeyFor(jobId: string): string {
  return `audit-reports/${jobId}.json`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAuditJob(env: Env, ownerKey: string, jobId: string): Promise<void> {
  if (!env.DB) return;
  const job = await claimAuditJob(env.DB, ownerKey, jobId);
  if (!job) return;

  try {
    await updateAuditJobProgress(env.DB, ownerKey, job.id, 0, job.maxPages);
    const previous = job.ownerEmail
      ? await getLatestComparableAudit(env.DB, job.ownerEmail, job.projectId, job.rootUrl)
      : null;

    let settled = false;
    let heartbeat = 5;
    const auditPromise = auditSite(job.rootUrl, { maxPages: job.maxPages }).finally(() => {
      settled = true;
    });

    while (!settled) {
      await Promise.race([auditPromise.then(() => undefined, () => undefined), sleep(800)]);
      if (!settled) {
        heartbeat = Math.min(90, heartbeat + 5);
        await heartbeatAuditJob(env.DB, ownerKey, job.id, heartbeat);
      }
    }

    const result = await auditPromise;
    await updateAuditJobProgress(env.DB, ownerKey, job.id, result.pagesScanned, job.maxPages);

    if (previous) result.comparison = compareAudits(result, previous);
    if (job.ownerEmail) await saveAudit(env.DB, job.ownerEmail, job.projectId, result);

    let reportKey: string | undefined;
    if (env.FILES) {
      reportKey = reportKeyFor(job.id);
      await env.FILES.put(reportKey, JSON.stringify(result, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          auditId: result.id,
          rootUrl: result.rootUrl.slice(0, 512),
          createdAt: result.finishedAt,
        },
      });
    }

    await completeAuditJob(env.DB, ownerKey, job.id, result, reportKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected audit job failure.";
    await failAuditJob(env.DB, ownerKey, job.id, message);
  }
}

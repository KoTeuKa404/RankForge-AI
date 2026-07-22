import { auditSite } from "./audit";
import { compareAudits } from "./compare";
import { getLatestComparableAudit, saveAudit } from "./db";
import type { Env } from "./env";
import {
  claimAuditJob,
  completeAuditJob,
  failAuditJob,
  updateAuditJobProgress,
} from "./audit-job-db";

function reportKeyFor(jobId: string): string {
  return `audit-reports/${jobId}.json`;
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

    const result = await auditSite(job.rootUrl, { maxPages: job.maxPages });
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

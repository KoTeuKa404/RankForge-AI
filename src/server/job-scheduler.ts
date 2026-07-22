import type { AuditQueueMessage, Env } from "./env";
import { runAuditJob } from "./audit-job-runner";
import { claimDueMonitors } from "./monitoring-db";
import { runMonitor } from "./monitor-runner";

export async function enqueueAuditJob(
  env: Env,
  context: ExecutionContext | undefined,
  ownerKey: string,
  jobId: string,
): Promise<void> {
  if (env.AUDIT_QUEUE) {
    await env.AUDIT_QUEUE.send({ ownerKey, jobId });
    return;
  }
  const task = runAuditJob(env, ownerKey, jobId);
  if (context) context.waitUntil(task);
  else await task;
}

export async function consumeAuditQueue(
  batch: MessageBatch<AuditQueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await runAuditJob(env, message.body.ownerKey, message.body.jobId);
      message.ack();
    } catch {
      message.retry({ delaySeconds: Math.min(300, 15 * Math.max(1, message.attempts)) });
    }
  }
}

async function recoverAuditJobs(env: Env, limit = 4): Promise<number> {
  if (!env.DB) return 0;
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE audit_jobs
     SET status = 'queued', phase = 'discovering', current_url = NULL, queued_urls = 0,
         error = 'Recovered after an interrupted worker execution.', updated_at = ?
     WHERE status = 'running' AND updated_at < ? AND attempts < 3`,
  ).bind(new Date().toISOString(), staleBefore).run();

  const result = await env.DB.prepare(
    `SELECT id, owner_key FROM audit_jobs
     WHERE status = 'queued' AND attempts < 3
     ORDER BY created_at ASC LIMIT ?`,
  ).bind(limit).all<{ id: string; owner_key: string }>();

  for (const job of result.results || []) {
    if (env.AUDIT_QUEUE) await env.AUDIT_QUEUE.send({ ownerKey: job.owner_key, jobId: job.id });
    else await runAuditJob(env, job.owner_key, job.id);
  }
  return result.results?.length || 0;
}

async function runDueMonitors(env: Env, limit = 2): Promise<number> {
  if (!env.DB) return 0;
  const due = await claimDueMonitors(env.DB, limit);
  for (const monitor of due) await runMonitor(env.DB, monitor.ownerEmail, monitor);
  return due.length;
}

export async function runScheduledMaintenance(env: Env): Promise<{ jobs: number; monitors: number }> {
  const [jobs, monitors] = await Promise.all([
    recoverAuditJobs(env),
    runDueMonitors(env),
  ]);
  return { jobs, monitors };
}

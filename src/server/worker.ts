import app from "./index";
import { getAiProviderStatus } from "./ai";
import { createAuditJob } from "./audit-job-db";
import { consumeRateLimit, userOwnsProject } from "./db";
import type { AuditQueueMessage, Env } from "./env";
import { getIdentity } from "./env";
import { handleSearchConsoleRequest } from "./gsc-routes";
import { consumeAuditQueue, enqueueAuditJob, runScheduledMaintenance } from "./job-scheduler";
import { normalizeTargetUrl, TargetValidationError } from "./security";
import { assertAndIncrementUsage, readUsage } from "./usage";

const HEALTH_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEALTH_HEADERS, ...extraHeaders },
  });
}

async function requestKey(request: Request, env: Env): Promise<string> {
  const identity = getIdentity(request, env);
  if (identity) return `user:${identity.email}`;
  const ip = request.headers.get("cf-connecting-ip") || "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return `ip:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function handleAuditJobStart(
  request: Request,
  env: Env,
  context: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/audit-jobs") return null;
  if (!env.DB) return json({ error: "D1 database is required for asynchronous audits." }, 503);

  const identity = getIdentity(request, env);
  const ownerKey = await requestKey(request, env);
  const allowed = await consumeRateLimit(env.DB, `audit-job:${ownerKey}`, identity ? 20 : 5, 3_600);
  if (!allowed) return json({ error: "Audit rate limit reached. Try again later." }, 429, { "retry-after": "3600" });

  const body = await request.json().catch(() => ({})) as {
    url?: unknown;
    maxPages?: unknown;
    projectId?: unknown;
  };
  const rootUrl = normalizeTargetUrl(String(body.url || "")).toString();
  const requestedPages = Number(body.maxPages || 10);
  const maxPages = [5, 10, 25].includes(requestedPages) ? requestedPages : 10;
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;

  if (projectId) {
    if (!identity) return json({ error: "Sign in to save audits to a project." }, 401);
    if (!(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
  }

  await assertAndIncrementUsage(env.DB, env, ownerKey, "pages_crawled", maxPages);
  await assertAndIncrementUsage(env.DB, env, ownerKey, "audit_jobs", 1);
  const job = await createAuditJob(env.DB, {
    ownerKey,
    ownerEmail: identity?.email || null,
    projectId,
    rootUrl,
    maxPages,
  });
  await enqueueAuditJob(env, context, ownerKey, job.id);
  return json({ job }, 202, { location: `/api/audit-jobs/${job.id}` });
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        const provider = getAiProviderStatus(env);
        return json({
          ok: true,
          version: "0.8.0-beta.0",
          database: Boolean(env.DB),
          asyncAudits: Boolean(env.DB),
          durableQueue: Boolean(env.AUDIT_QUEUE),
          reportStorage: Boolean(env.FILES),
          searchConsole: Boolean(env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_TOKEN_SECRET),
          ai: provider.enabled,
          aiProvider: provider.preferred,
          aiMode: provider.mode,
          aiProviders: provider.available,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/usage") {
        if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
        return json({ usage: await readUsage(env.DB, env, await requestKey(request, env)) });
      }

      const auditStart = await handleAuditJobStart(request, env, context);
      if (auditStart) return auditStart;

      if (url.pathname.startsWith("/api/gsc/")) {
        if (request.method === "POST" && url.pathname === "/api/gsc/sync" && env.DB) {
          await assertAndIncrementUsage(env.DB, env, await requestKey(request, env), "gsc_syncs", 1);
        }
        const response = await handleSearchConsoleRequest(request, env);
        if (response) return response;
      }

      if (request.method === "POST" && url.pathname === "/api/ai-fix" && env.DB) {
        await assertAndIncrementUsage(env.DB, env, await requestKey(request, env), "ai_fixes", 1);
      }

      return app.fetch(request, env, context);
    } catch (error) {
      if (error instanceof TargetValidationError) return json({ error: error.message }, 400);
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      console.error("worker_request_failed", { message });
      return json({ error: env.ENVIRONMENT === "development" ? message : "Unexpected server error." }, 500);
    }
  },

  async queue(batch: MessageBatch<AuditQueueMessage>, env: Env): Promise<void> {
    await consumeAuditQueue(batch, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(runScheduledMaintenance(env).then(() => undefined));
  },
};

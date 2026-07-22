import app from "./index";
import { generateAiFix, getAiProviderStatus } from "./ai";
import { evaluateAiFix } from "./ai-evaluation";
import { createAuditJob, getAuditJob, resetAuditJob } from "./audit-job-db";
import { consumeRateLimit, getAudit, userOwnsProject } from "./db";
import type { AuditQueueMessage, Env } from "./env";
import { getIdentity } from "./env";
import { handleSearchConsoleRequest } from "./gsc-routes";
import { saveInternalLinkAnalysis } from "./internal-link-db";
import { consumeAuditQueue, enqueueAuditJob, runScheduledMaintenance } from "./job-scheduler";
import { analyzeInternalLinksSemantic } from "./semantic-links";
import { normalizeTargetUrl, TargetValidationError } from "./security";
import type { PageAudit, SeoIssue } from "../shared/types";
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

async function handleAuditJobRetry(
  request: Request,
  env: Env,
  context: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/audit-jobs\/([0-9a-f-]+)\/retry$/i);
  if (request.method !== "POST" || !match) return null;
  if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
  const ownerKey = await requestKey(request, env);
  const reset = await resetAuditJob(env.DB, ownerKey, match[1]);
  if (!reset) return json({ error: "Only failed jobs with fewer than three attempts can be retried." }, 409);
  await enqueueAuditJob(env, context, ownerKey, match[1]);
  const job = await getAuditJob(env.DB, ownerKey, match[1]);
  return json({ job }, 202);
}

async function handleSemanticLinks(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/internal-link-analyses") return null;
  const identity = getIdentity(request, env);
  if (!identity) return json({ error: "Sign in with ChatGPT to analyze a saved crawl." }, 401);
  if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
  const body = await request.json().catch(() => ({})) as { auditId?: unknown; projectId?: unknown };
  if (typeof body.auditId !== "string" || !body.auditId) {
    throw new TargetValidationError("Select a saved audit first.");
  }
  const audit = await getAudit(env.DB, identity.email, body.auditId);
  if (!audit) return json({ error: "Audit not found." }, 404);
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) {
    return json({ error: "Project not found." }, 404);
  }
  const analysis = await analyzeInternalLinksSemantic(env, audit);
  analysis.projectId = projectId;
  await saveInternalLinkAnalysis(env.DB, identity.email, analysis);
  return json({ analysis }, 201);
}

async function handleAiFix(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/ai-fix") return null;
  const ownerKey = await requestKey(request, env);
  if (env.DB) await assertAndIncrementUsage(env.DB, env, ownerKey, "ai_fixes", 1);
  const raw = await request.text();
  if (raw.length > 40_000) throw new TargetValidationError("Request body is too large.");
  let body: { issue?: SeoIssue; page?: PageAudit | PageAudit[] };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    throw new TargetValidationError("Request body must be valid JSON.");
  }
  if (!body.issue || typeof body.issue !== "object") throw new TargetValidationError("A valid issue is required.");
  const fix = await generateAiFix(env, body.issue, body.page, ownerKey);
  const evaluation = evaluateAiFix(fix, body.issue);
  if (!evaluation.passed) {
    console.warn("ai_fix_rejected", { score: evaluation.score, warnings: evaluation.warnings });
    return json({ error: "The AI response failed RankForge quality checks. Retry generation.", evaluation }, 502);
  }
  return json({ fix: { ...fix, qualityScore: evaluation.score, qualityWarnings: evaluation.warnings } });
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        const provider = getAiProviderStatus(env);
        return json({
          ok: true,
          version: "1.0.0-rc.1",
          database: Boolean(env.DB),
          asyncAudits: Boolean(env.DB),
          durableQueue: Boolean(env.AUDIT_QUEUE),
          reportStorage: Boolean(env.FILES),
          searchConsole: Boolean(env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_TOKEN_SECRET),
          semanticLinks: Boolean(env.GEMINI_API_KEY),
          dnsPreflight: true,
          aiQualityGate: true,
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
      const auditRetry = await handleAuditJobRetry(request, env, context);
      if (auditRetry) return auditRetry;
      const semanticLinks = await handleSemanticLinks(request, env);
      if (semanticLinks) return semanticLinks;
      const aiFix = await handleAiFix(request, env);
      if (aiFix) return aiFix;

      if (url.pathname.startsWith("/api/gsc/")) {
        if (request.method === "POST" && url.pathname === "/api/gsc/sync" && env.DB) {
          await assertAndIncrementUsage(env.DB, env, await requestKey(request, env), "gsc_syncs", 1);
        }
        const response = await handleSearchConsoleRequest(request, env);
        if (response) return response;
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

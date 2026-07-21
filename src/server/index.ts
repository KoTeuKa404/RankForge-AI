import type { PageAudit, SeoIssue } from "../shared/types";
import { auditSite } from "./audit";
import { generateAiFix } from "./ai";
import { createProject, getAudit, getLatestComparableAudit, listAudits, listProjects, saveAudit, consumeRateLimit, userOwnsProject } from "./db";
import type { Env } from "./env";
import { getIdentity } from "./env";
import { normalizeTargetUrl, TargetValidationError } from "./security";
import { compareAudits } from "./compare";
import { analyzeKeywords } from "./keywords";
import { generateContentBrief, sanitizeContentBrief } from "./content-briefs";
import { analyzeInternalLinks } from "./internal-links";
import { validateCadence } from "./monitoring";
import { beginMonitorRun, claimDueMonitors, createMonitor, getMonitor, listMonitoringAlerts, listMonitors, markAlertRead, setMonitorEnabled } from "./monitoring-db";
import { runMonitor } from "./monitor-runner";
import { getInternalLinkAnalysis, listInternalLinkAnalyses, saveInternalLinkAnalysis } from "./internal-link-db";
import { getContentBrief, listContentBriefs, saveContentBrief, updateContentBrief } from "./content-brief-db";
import { getKeywordAnalysis, listKeywordAnalyses, saveKeywordAnalysis } from "./keyword-db";

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

async function parseJsonBody<T>(request: Request, maxBytes = 20_000): Promise<T> {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > maxBytes) throw new TargetValidationError("Request body is too large.");
  const raw = await request.text();
  if (raw.length > maxBytes) throw new TargetValidationError("Request body is too large.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new TargetValidationError("Request body must be valid JSON.");
  }
}

async function requestKey(request: Request, env: Env): Promise<string> {
  const identity = getIdentity(request, env);
  if (identity) return `user:${identity.email}`;
  const ip = request.headers.get("cf-connecting-ip") || "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return `ip:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new TargetValidationError("Project name is required.");
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) throw new TargetValidationError("Project name must be 2–80 characters.");
  return name;
}


async function validSystemToken(request: Request, expected?: string): Promise<boolean> {
  if (!expected || expected.length < 24) return false;
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const identity = getIdentity(request, env);

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, version: "0.6.0", database: Boolean(env.DB), ai: Boolean(env.OPENAI_API_KEY) });
  }

  if (request.method === "GET" && path === "/api/me") {
    return json(identity
      ? { authenticated: true, email: identity.email, name: identity.name }
      : { authenticated: false });
  }

  if (request.method === "GET" && path === "/api/projects") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access saved projects." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    return json({ projects: await listProjects(env.DB, identity.email) });
  }

  if (request.method === "POST" && path === "/api/projects") {
    if (!identity) return json({ error: "Sign in with ChatGPT to create projects." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const body = await parseJsonBody<{ name?: unknown; rootUrl?: unknown }>(request);
    const name = cleanName(body.name);
    const rootUrl = normalizeTargetUrl(String(body.rootUrl || "")).toString();
    return json({ project: await createProject(env.DB, identity.email, name, rootUrl) }, 201);
  }

  if (request.method === "GET" && path === "/api/audits") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access audit history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const projectId = url.searchParams.get("projectId") || undefined;
    if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    return json({ audits: await listAudits(env.DB, identity.email, projectId) });
  }

  const auditMatch = path.match(/^\/api\/audits\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && auditMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to access audit history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const audit = await getAudit(env.DB, identity.email, auditMatch[1]);
    return audit ? json({ audit }) : json({ error: "Audit not found." }, 404);
  }

  if (request.method === "POST" && path === "/api/audits") {
    const key = await requestKey(request, env);
    const allowed = await consumeRateLimit(env.DB, `audit:${key}`, identity ? 20 : 5, 3_600);
    if (!allowed) return json({ error: "Audit rate limit reached. Try again later." }, 429, { "retry-after": "3600" });

    const body = await parseJsonBody<{ url?: unknown; maxPages?: unknown; projectId?: unknown }>(request);
    const target = normalizeTargetUrl(String(body.url || ""));
    const maxPages = Number(body.maxPages || 10);
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;

    if (projectId) {
      if (!identity) return json({ error: "Sign in to save audits to a project." }, 401);
      if (!env.DB || !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    }

    const previous = identity && env.DB
      ? await getLatestComparableAudit(env.DB, identity.email, projectId, target.toString())
      : null;
    const result = await auditSite(target.toString(), { maxPages });
    if (previous) result.comparison = compareAudits(result, previous);
    if (identity && env.DB) await saveAudit(env.DB, identity.email, projectId, result);
    return json({ audit: result }, 201);
  }

  if (request.method === "GET" && path === "/api/keyword-analyses") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access keyword analysis history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const projectId = url.searchParams.get("projectId") || undefined;
    if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    return json({ analyses: await listKeywordAnalyses(env.DB, identity.email, projectId) });
  }

  const keywordAnalysisMatch = path.match(/^\/api\/keyword-analyses\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && keywordAnalysisMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to access keyword analysis history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const analysis = await getKeywordAnalysis(env.DB, identity.email, keywordAnalysisMatch[1]);
    return analysis ? json({ analysis }) : json({ error: "Keyword analysis not found." }, 404);
  }

  if (request.method === "POST" && path === "/api/keyword-analyses") {
    const key = await requestKey(request, env);
    const allowed = await consumeRateLimit(env.DB, `keywords:${key}`, identity ? 30 : 5, 3_600);
    if (!allowed) return json({ error: "Keyword analysis rate limit reached. Try again later." }, 429, { "retry-after": "3600" });

    const body = await parseJsonBody<{ input?: unknown; projectId?: unknown; name?: unknown }>(request, 180_000);
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    if (projectId) {
      if (!identity) return json({ error: "Sign in to save keyword analysis to a project." }, 401);
      if (!env.DB || !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    }

    const analysis = analyzeKeywords(String(body.input || ""), {
      maxKeywords: identity ? 2_000 : 300,
      projectId,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    if (identity && env.DB) await saveKeywordAnalysis(env.DB, identity.email, analysis);
    return json({ analysis }, 201);
  }




  if (request.method === "POST" && path === "/api/system/run-monitors") {
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    if (!(await validSystemToken(request, env.MONITOR_TOKEN))) return json({ error: "Unauthorized." }, 401);
    const due = await claimDueMonitors(env.DB, 2);
    const results = [];
    for (const monitor of due) results.push(await runMonitor(env.DB, monitor.ownerEmail, monitor));
    return json({ processed: results.length, succeeded: results.filter((item) => item.audit).length, failed: results.filter((item) => !item.audit).length });
  }

  if (request.method === "GET" && path === "/api/monitors") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access monitoring." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    return json({ monitors: await listMonitors(env.DB, identity.email) });
  }

  if (request.method === "POST" && path === "/api/monitors") {
    if (!identity) return json({ error: "Sign in with ChatGPT to create monitors." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const body = await parseJsonBody<{ projectId?: unknown; name?: unknown; rootUrl?: unknown; maxPages?: unknown; cadence?: unknown }>(request);
    if (typeof body.projectId !== "string" || !(await userOwnsProject(env.DB, identity.email, body.projectId))) return json({ error: "Project not found." }, 404);
    const monitorCount = (await listMonitors(env.DB, identity.email)).length;
    if (monitorCount >= 20) return json({ error: "A maximum of 20 monitors is allowed per account." }, 400);
    const monitor = await createMonitor(env.DB, identity.email, {
      projectId: body.projectId,
      name: cleanName(body.name),
      rootUrl: normalizeTargetUrl(String(body.rootUrl || "")).toString(),
      maxPages: [5, 10, 25].includes(Number(body.maxPages)) ? Number(body.maxPages) : 10,
      cadence: validateCadence(body.cadence || "weekly"),
    });
    return json({ monitor }, 201);
  }

  const monitorMatch = path.match(/^\/api\/monitors\/([0-9a-f-]+)$/i);
  if (request.method === "PUT" && monitorMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to update monitoring." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const body = await parseJsonBody<{ enabled?: unknown }>(request);
    if (typeof body.enabled !== "boolean") throw new TargetValidationError("enabled must be boolean.");
    const monitor = await setMonitorEnabled(env.DB, identity.email, monitorMatch[1], body.enabled);
    return monitor ? json({ monitor }) : json({ error: "Monitor not found." }, 404);
  }

  const monitorRunMatch = path.match(/^\/api\/monitors\/([0-9a-f-]+)\/run$/i);
  if (request.method === "POST" && monitorRunMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to run monitoring." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const monitor = await getMonitor(env.DB, identity.email, monitorRunMatch[1]);
    if (!monitor) return json({ error: "Monitor not found." }, 404);
    if (!(await beginMonitorRun(env.DB, identity.email, monitor.id))) return json({ error: "This monitor is already running." }, 409);
    return json(await runMonitor(env.DB, identity.email, monitor));
  }

  if (request.method === "GET" && path === "/api/monitoring-alerts") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access monitoring alerts." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    return json({ alerts: await listMonitoringAlerts(env.DB, identity.email) });
  }

  const alertReadMatch = path.match(/^\/api\/monitoring-alerts\/([0-9a-f-]+)\/read$/i);
  if (request.method === "POST" && alertReadMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to update alerts." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const updated = await markAlertRead(env.DB, identity.email, alertReadMatch[1]);
    return updated ? json({ ok: true }) : json({ error: "Alert not found." }, 404);
  }

  if (request.method === "GET" && path === "/api/internal-link-analyses") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access internal link history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const projectId = url.searchParams.get("projectId") || undefined;
    if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    return json({ analyses: await listInternalLinkAnalyses(env.DB, identity.email, projectId) });
  }

  const internalLinkMatch = path.match(/^\/api\/internal-link-analyses\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && internalLinkMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to access internal link analyses." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const analysis = await getInternalLinkAnalysis(env.DB, identity.email, internalLinkMatch[1]);
    return analysis ? json({ analysis }) : json({ error: "Internal link analysis not found." }, 404);
  }

  if (request.method === "POST" && path === "/api/internal-link-analyses") {
    if (!identity) return json({ error: "Sign in with ChatGPT to analyze a saved crawl." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const key = await requestKey(request, env);
    const allowed = await consumeRateLimit(env.DB, `links:${key}`, 30, 3_600);
    if (!allowed) return json({ error: "Internal link analysis rate limit reached. Try again later." }, 429, { "retry-after": "3600" });
    const body = await parseJsonBody<{ auditId?: unknown; projectId?: unknown }>(request);
    if (typeof body.auditId !== "string" || !body.auditId) throw new TargetValidationError("Select a saved audit first.");
    const audit = await getAudit(env.DB, identity.email, body.auditId);
    if (!audit) return json({ error: "Audit not found." }, 404);
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    const analysis = analyzeInternalLinks(audit);
    analysis.projectId = projectId;
    await saveInternalLinkAnalysis(env.DB, identity.email, analysis);
    return json({ analysis }, 201);
  }

  if (request.method === "GET" && path === "/api/content-briefs") {
    if (!identity) return json({ error: "Sign in with ChatGPT to access content brief history." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const projectId = url.searchParams.get("projectId") || undefined;
    if (projectId && !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    return json({ briefs: await listContentBriefs(env.DB, identity.email, projectId) });
  }

  const contentBriefMatch = path.match(/^\/api\/content-briefs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && contentBriefMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to access content briefs." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const brief = await getContentBrief(env.DB, identity.email, contentBriefMatch[1]);
    return brief ? json({ brief }) : json({ error: "Content brief not found." }, 404);
  }

  if (request.method === "POST" && path === "/api/content-briefs") {
    const key = await requestKey(request, env);
    const allowed = await consumeRateLimit(env.DB, `briefs:${key}`, identity ? 40 : 8, 3_600);
    if (!allowed) return json({ error: "Content brief rate limit reached. Try again later." }, 429, { "retry-after": "3600" });
    const body = await parseJsonBody<{ cluster?: unknown; projectId?: unknown; sourceAnalysisId?: unknown; name?: unknown }>(request, 80_000);
    if (!body.cluster || typeof body.cluster !== "object") throw new TargetValidationError("A valid keyword cluster is required.");
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    if (projectId) {
      if (!identity) return json({ error: "Sign in to save content briefs to a project." }, 401);
      if (!env.DB || !(await userOwnsProject(env.DB, identity.email, projectId))) return json({ error: "Project not found." }, 404);
    }
    const requestedAnalysisId = typeof body.sourceAnalysisId === "string" && body.sourceAnalysisId ? body.sourceAnalysisId : null;
    let cluster = body.cluster as import("../shared/types").KeywordCluster;
    if (requestedAnalysisId) {
      if (!identity || !env.DB) return json({ error: "Sign in to create a brief from a saved keyword analysis." }, 401);
      const sourceAnalysis = await getKeywordAnalysis(env.DB, identity.email, requestedAnalysisId);
      if (!sourceAnalysis) return json({ error: "Keyword analysis not found." }, 404);
      const sourceClusterId = typeof cluster.id === "string" ? cluster.id : "";
      const trustedCluster = sourceAnalysis.clusters.find((candidate) => candidate.id === sourceClusterId);
      if (!trustedCluster) return json({ error: "Keyword cluster not found in the selected analysis." }, 404);
      cluster = trustedCluster;
    }
    const brief = generateContentBrief(cluster, {
      projectId,
      sourceAnalysisId: requestedAnalysisId,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    if (identity && env.DB) await saveContentBrief(env.DB, identity.email, brief);
    return json({ brief }, 201);
  }

  if (request.method === "PUT" && contentBriefMatch) {
    if (!identity) return json({ error: "Sign in with ChatGPT to update content briefs." }, 401);
    if (!env.DB) return json({ error: "D1 database is not configured." }, 503);
    const existing = await getContentBrief(env.DB, identity.email, contentBriefMatch[1]);
    if (!existing) return json({ error: "Content brief not found." }, 404);
    const body = await parseJsonBody<{ brief?: unknown }>(request, 120_000);
    const brief = sanitizeContentBrief(body.brief, existing);
    await updateContentBrief(env.DB, identity.email, brief);
    return json({ brief });
  }

  if (request.method === "POST" && path === "/api/ai-fix") {
    const key = await requestKey(request, env);
    const allowed = await consumeRateLimit(env.DB, `ai:${key}`, identity ? 30 : 3, 3_600);
    if (!allowed) return json({ error: "AI generation rate limit reached. Try again later." }, 429, { "retry-after": "3600" });

    const body = await parseJsonBody<{ issue?: SeoIssue; page?: PageAudit }>(request, 40_000);
    if (!body.issue || typeof body.issue !== "object") throw new TargetValidationError("A valid issue is required.");
    const fix = await generateAiFix(env, body.issue, body.page, key);
    return json({ fix });
  }

  return json({ error: "API route not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      if (env.ASSETS) {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return new Response("RankForge AI frontend is not built. Run npm run build.", { status: 503, headers: SECURITY_HEADERS });
    } catch (error) {
      if (error instanceof TargetValidationError) return json({ error: error.message }, 400);
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      console.error("request_failed", { message, stack: error instanceof Error ? error.stack : undefined });
      return json({ error: env.ENVIRONMENT === "development" ? message : "Unexpected server error." }, 500);
    }
  },
};

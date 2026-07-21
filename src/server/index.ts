import type { PageAudit, SeoIssue } from "../shared/types";
import { auditSite } from "./audit";
import { generateAiFix } from "./ai";
import { createProject, getAudit, listAudits, listProjects, saveAudit, consumeRateLimit, userOwnsProject } from "./db";
import type { Env } from "./env";
import { getIdentity } from "./env";
import { normalizeTargetUrl, TargetValidationError } from "./security";

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

async function requestKey(request: Request): Promise<string> {
  const identity = getIdentity(request);
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

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const identity = getIdentity(request);

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, version: "0.1.0", database: Boolean(env.DB), ai: Boolean(env.OPENAI_API_KEY) });
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
    const key = await requestKey(request);
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

    const result = await auditSite(target.toString(), { maxPages });
    if (identity && env.DB) await saveAudit(env.DB, identity.email, projectId, result);
    return json({ audit: result }, 201);
  }

  if (request.method === "POST" && path === "/api/ai-fix") {
    const key = await requestKey(request);
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

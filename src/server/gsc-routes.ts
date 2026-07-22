import type { Env } from "./env";
import { getIdentity } from "./env";
import {
  completeSearchConsoleAuthorization,
  createSearchConsoleAuthorizationUrl,
  isSearchConsoleConfigured,
  listSearchConsoleProperties,
  syncSearchConsole,
} from "./gsc";
import {
  deleteSearchConsoleConnection,
  getSearchConsoleStatus,
  listSearchConsoleSnapshots,
  setSearchConsoleSite,
} from "./gsc-db";
import { userOwnsProject } from "./db";
import { TargetValidationError } from "./security";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

async function body<T>(request: Request, maxBytes = 20_000): Promise<T> {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new TargetValidationError("Request body is too large.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new TargetValidationError("Request body must be valid JSON.");
  }
}

async function ownedProject(
  env: Env,
  email: string,
  projectId: unknown,
): Promise<string> {
  if (!env.DB) throw new TargetValidationError("D1 database is not configured.");
  if (typeof projectId !== "string" || !projectId) throw new TargetValidationError("Select a project first.");
  if (!(await userOwnsProject(env.DB, email, projectId))) throw new TargetValidationError("Project not found.");
  return projectId;
}

export async function handleSearchConsoleRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/gsc/")) return null;
  if (!env.DB) return json({ error: "D1 database is not configured." }, 503);

  if (request.method === "GET" && url.pathname === "/api/gsc/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return Response.redirect(new URL(`/?gsc=error&reason=${encodeURIComponent(oauthError)}`, url.origin), 302);
    }
    if (!state || !code) return json({ error: "Google OAuth callback is incomplete." }, 400);
    try {
      const result = await completeSearchConsoleAuthorization(env, env.DB, state, code);
      return Response.redirect(
        new URL(`/?gsc=connected&projectId=${encodeURIComponent(result.projectId)}`, url.origin),
        302,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google OAuth failed.";
      return Response.redirect(new URL(`/?gsc=error&reason=${encodeURIComponent(message)}`, url.origin), 302);
    }
  }

  const identity = getIdentity(request, env);
  if (!identity) return json({ error: "Sign in with ChatGPT to use Search Console." }, 401);

  if (request.method === "GET" && url.pathname === "/api/gsc/status") {
    const projectId = await ownedProject(env, identity.email, url.searchParams.get("projectId"));
    return json({
      status: await getSearchConsoleStatus(
        env.DB,
        identity.email,
        projectId,
        isSearchConsoleConfigured(env),
      ),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/gsc/connect") {
    const input = await body<{ projectId?: unknown }>(request);
    const projectId = await ownedProject(env, identity.email, input.projectId);
    const authorizationUrl = await createSearchConsoleAuthorizationUrl(
      env,
      env.DB,
      identity.email,
      projectId,
      request.url,
    );
    return json({ authorizationUrl });
  }

  if (request.method === "GET" && url.pathname === "/api/gsc/properties") {
    const projectId = await ownedProject(env, identity.email, url.searchParams.get("projectId"));
    return json({ properties: await listSearchConsoleProperties(env, env.DB, identity.email, projectId) });
  }

  if (request.method === "POST" && url.pathname === "/api/gsc/select-property") {
    const input = await body<{ projectId?: unknown; siteUrl?: unknown }>(request);
    const projectId = await ownedProject(env, identity.email, input.projectId);
    if (typeof input.siteUrl !== "string" || !input.siteUrl.trim()) {
      throw new TargetValidationError("Select a Search Console property.");
    }
    const properties = await listSearchConsoleProperties(env, env.DB, identity.email, projectId);
    if (!properties.some((property) => property.siteUrl === input.siteUrl)) {
      throw new TargetValidationError("The selected Search Console property is not available to this account.");
    }
    await setSearchConsoleSite(env.DB, identity.email, projectId, input.siteUrl);
    return json({ ok: true, siteUrl: input.siteUrl });
  }

  if (request.method === "POST" && url.pathname === "/api/gsc/sync") {
    const input = await body<{ projectId?: unknown; days?: unknown }>(request);
    const projectId = await ownedProject(env, identity.email, input.projectId);
    const days = [7, 28, 90].includes(Number(input.days)) ? Number(input.days) : 28;
    return json({ snapshot: await syncSearchConsole(env, env.DB, identity.email, projectId, days) }, 201);
  }

  if (request.method === "GET" && url.pathname === "/api/gsc/snapshots") {
    const projectId = await ownedProject(env, identity.email, url.searchParams.get("projectId"));
    return json({ snapshots: await listSearchConsoleSnapshots(env.DB, identity.email, projectId) });
  }

  if (request.method === "DELETE" && url.pathname === "/api/gsc/connection") {
    const projectId = await ownedProject(env, identity.email, url.searchParams.get("projectId"));
    const deleted = await deleteSearchConsoleConnection(env.DB, identity.email, projectId);
    return json({ ok: deleted });
  }

  return json({ error: "Search Console route not found." }, 404);
}

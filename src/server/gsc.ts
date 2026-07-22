import type {
  SearchConsoleProperty,
  SearchConsoleRow,
  SearchConsoleSnapshot,
  SearchOpportunity,
  SearchOpportunityKind,
} from "../shared/search-console";
import type { Env } from "./env";
import {
  consumeOauthState,
  createOauthState,
  getSearchConsoleConnection,
  saveSearchConsoleSnapshot,
  upsertSearchConsoleConnection,
} from "./gsc-db";
import { decryptSecret, encryptSecret } from "./secret-box";
import { TargetValidationError } from "./security";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://www.googleapis.com/webmasters/v3";
const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface SitesResponse {
  siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  error?: { message?: string };
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
  error?: { message?: string };
}

function requireConfig(env: Env): {
  clientId: string;
  clientSecret: string;
  tokenSecret: string;
} {
  const clientId = env.GSC_CLIENT_ID?.trim();
  const clientSecret = env.GSC_CLIENT_SECRET?.trim();
  const tokenSecret = env.GSC_TOKEN_SECRET?.trim();
  if (!clientId || !clientSecret || !tokenSecret) {
    throw new TargetValidationError(
      "Google Search Console is not configured. Add GSC_CLIENT_ID, GSC_CLIENT_SECRET, and GSC_TOKEN_SECRET.",
    );
  }
  return { clientId, clientSecret, tokenSecret };
}

export function isSearchConsoleConfigured(env: Env): boolean {
  return Boolean(env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_TOKEN_SECRET);
}

function redirectUriFor(env: Env, requestUrl: string): string {
  if (env.GSC_REDIRECT_URI?.trim()) return env.GSC_REDIRECT_URI.trim();
  return new URL("/api/gsc/callback", new URL(requestUrl).origin).toString();
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new TargetValidationError(
      payload.error_description || payload.error || "Google OAuth token exchange failed.",
    );
  }
  return payload;
}

export async function createSearchConsoleAuthorizationUrl(
  env: Env,
  db: D1Database,
  ownerEmail: string,
  projectId: string,
  requestUrl: string,
): Promise<string> {
  const { clientId } = requireConfig(env);
  const redirectUri = redirectUriFor(env, requestUrl);
  const state = await createOauthState(db, ownerEmail, projectId, redirectUri);
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function fetchProperties(accessToken: string): Promise<SearchConsoleProperty[]> {
  const response = await fetch(`${API_ROOT}/sites`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as SitesResponse;
  if (!response.ok) {
    throw new TargetValidationError(payload.error?.message || "Could not read Search Console properties.");
  }
  return (payload.siteEntry || [])
    .filter((entry) => entry.siteUrl)
    .map((entry) => ({
      siteUrl: entry.siteUrl || "",
      permissionLevel: entry.permissionLevel || "unknown",
    }));
}

function chooseProperty(properties: SearchConsoleProperty[], rootUrl: string): string | null {
  if (properties.length === 0) return null;
  const root = new URL(rootUrl);
  const exact = properties.find((item) => item.siteUrl === root.origin + "/" || item.siteUrl === rootUrl);
  if (exact) return exact.siteUrl;
  const domain = properties.find((item) => item.siteUrl === `sc-domain:${root.hostname}`);
  if (domain) return domain.siteUrl;
  const prefix = properties.find((item) => item.siteUrl.startsWith(root.origin));
  return prefix?.siteUrl || properties[0].siteUrl;
}

export async function completeSearchConsoleAuthorization(
  env: Env,
  db: D1Database,
  state: string,
  code: string,
): Promise<{ ownerEmail: string; projectId: string; siteUrl: string | null }> {
  const config = requireConfig(env);
  const oauthState = await consumeOauthState(db, state);
  if (!oauthState) throw new TargetValidationError("The Google OAuth state is invalid or expired.");

  const token = await postToken(new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: oauthState.redirectUri,
    grant_type: "authorization_code",
  }));

  const project = await db.prepare(
    "SELECT root_url FROM projects WHERE id = ? AND owner_email = ? LIMIT 1",
  ).bind(oauthState.projectId, oauthState.ownerEmail).first<{ root_url: string }>();
  if (!project) throw new TargetValidationError("The selected project no longer exists.");

  const properties = await fetchProperties(token.access_token!);
  const siteUrl = chooseProperty(properties, project.root_url);
  const expiresAt = Date.now() + Math.max(60, token.expires_in || 3_600) * 1_000;

  await upsertSearchConsoleConnection(db, {
    ownerEmail: oauthState.ownerEmail,
    projectId: oauthState.projectId,
    siteUrl,
    encryptedAccessToken: await encryptSecret(token.access_token!, config.tokenSecret),
    encryptedRefreshToken: token.refresh_token
      ? await encryptSecret(token.refresh_token, config.tokenSecret)
      : null,
    tokenExpiresAt: expiresAt,
    scope: token.scope || READONLY_SCOPE,
  });

  return { ownerEmail: oauthState.ownerEmail, projectId: oauthState.projectId, siteUrl };
}

async function validAccessToken(
  env: Env,
  db: D1Database,
  ownerEmail: string,
  projectId: string,
): Promise<string> {
  const config = requireConfig(env);
  const connection = await getSearchConsoleConnection(db, ownerEmail, projectId);
  if (!connection) throw new TargetValidationError("Connect Google Search Console first.");

  if (connection.tokenExpiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.encryptedAccessToken, config.tokenSecret);
  }
  if (!connection.encryptedRefreshToken) {
    throw new TargetValidationError("Google access expired and no refresh token is available. Reconnect Search Console.");
  }

  const refreshToken = await decryptSecret(connection.encryptedRefreshToken, config.tokenSecret);
  const token = await postToken(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  }));
  await upsertSearchConsoleConnection(db, {
    ownerEmail,
    projectId,
    siteUrl: connection.siteUrl,
    encryptedAccessToken: await encryptSecret(token.access_token!, config.tokenSecret),
    encryptedRefreshToken: connection.encryptedRefreshToken,
    tokenExpiresAt: Date.now() + Math.max(60, token.expires_in || 3_600) * 1_000,
    scope: token.scope || connection.scope,
  });
  return token.access_token!;
}

export async function listSearchConsoleProperties(
  env: Env,
  db: D1Database,
  ownerEmail: string,
  projectId: string,
): Promise<SearchConsoleProperty[]> {
  return fetchProperties(await validAccessToken(env, db, ownerEmail, projectId));
}

function opportunity(
  row: SearchConsoleRow,
  kind: SearchOpportunityKind,
  score: number,
  recommendation: string,
): SearchOpportunity {
  return {
    id: crypto.randomUUID(),
    kind,
    ...row,
    score: Math.max(0, Math.min(100, Math.round(score))),
    recommendation,
  };
}

export function buildSearchOpportunities(rows: SearchConsoleRow[]): SearchOpportunity[] {
  const output: SearchOpportunity[] = [];
  for (const row of rows) {
    if (row.impressions < 20) continue;
    const ctrPercent = row.ctr * 100;
    if (row.position >= 4 && row.position <= 20) {
      output.push(opportunity(
        row,
        "striking-distance",
        35 + Math.log10(row.impressions + 1) * 16 + Math.max(0, 20 - row.position) * 1.8,
        "Strengthen this page for the query, improve internal links, and align title/H1/content with the search intent.",
      ));
    }
    if (row.position <= 10 && ctrPercent < 2.5) {
      output.push(opportunity(
        row,
        "low-ctr",
        45 + Math.log10(row.impressions + 1) * 15 + Math.max(0, 2.5 - ctrPercent) * 8,
        "Rewrite the title and meta description to better match the query and make the result more specific and compelling.",
      ));
    }
    if (row.impressions >= 250 && row.clicks < 5) {
      output.push(opportunity(
        row,
        "high-impressions",
        50 + Math.log10(row.impressions + 1) * 14 - row.clicks,
        "Review intent mismatch, SERP presentation, and whether this query deserves a dedicated section or page.",
      ));
    }
  }

  const best = new Map<string, SearchOpportunity>();
  for (const item of output) {
    const key = `${item.kind}|${item.query}|${item.page}`;
    const current = best.get(key);
    if (!current || item.score > current.score) best.set(key, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 250);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function syncSearchConsole(
  env: Env,
  db: D1Database,
  ownerEmail: string,
  projectId: string,
  days = 28,
): Promise<SearchConsoleSnapshot> {
  const connection = await getSearchConsoleConnection(db, ownerEmail, projectId);
  if (!connection?.siteUrl) throw new TargetValidationError("Select a Search Console property first.");
  const accessToken = await validAccessToken(env, db, ownerEmail, projectId);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(6, Math.min(89, days - 1)));
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);

  const response = await fetch(
    `${API_ROOT}/sites/${encodeURIComponent(connection.siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["query", "page"],
        type: "web",
        aggregationType: "auto",
        rowLimit: 5_000,
        dataState: "final",
      }),
    },
  );
  const payload = await response.json().catch(() => ({})) as SearchAnalyticsResponse;
  if (!response.ok) {
    throw new TargetValidationError(payload.error?.message || "Search Console synchronization failed.");
  }

  const rows: SearchConsoleRow[] = (payload.rows || []).map((row) => ({
    query: row.keys?.[0] || "",
    page: row.keys?.[1] || "",
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  })).filter((row) => row.query && row.page);

  const snapshot: SearchConsoleSnapshot = {
    id: crypto.randomUUID(),
    projectId,
    siteUrl: connection.siteUrl,
    startDate,
    endDate,
    rowCount: rows.length,
    rows,
    opportunities: buildSearchOpportunities(rows),
    createdAt: new Date().toISOString(),
  };
  await saveSearchConsoleSnapshot(db, ownerEmail, snapshot);
  return snapshot;
}

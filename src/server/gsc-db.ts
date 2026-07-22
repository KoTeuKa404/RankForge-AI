import type {
  SearchConsoleConnectionStatus,
  SearchConsoleSnapshot,
} from "../shared/search-console";

interface ConnectionRow {
  id: string;
  owner_email: string;
  project_id: string;
  site_url: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expires_at: number;
  scope: string;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  project_id: string;
  site_url: string;
  start_date: string;
  end_date: string;
  row_count: number;
  rows_json: string;
  opportunities_json: string;
  created_at: string;
}

export interface StoredSearchConsoleConnection {
  id: string;
  ownerEmail: string;
  projectId: string;
  siteUrl: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: number;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

function fromConnectionRow(row: ConnectionRow): StoredSearchConsoleConnection {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    projectId: row.project_id,
    siteUrl: row.site_url,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    tokenExpiresAt: row.token_expires_at,
    scope: row.scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fromSnapshotRow(row: SnapshotRow): SearchConsoleSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    siteUrl: row.site_url,
    startDate: row.start_date,
    endDate: row.end_date,
    rowCount: row.row_count,
    rows: parseJson(row.rows_json, []),
    opportunities: parseJson(row.opportunities_json, []),
    createdAt: row.created_at,
  };
}

export async function createOauthState(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
  redirectUri: string,
): Promise<string> {
  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  await db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now).run();
  await db.prepare(
    `INSERT INTO oauth_states (state, owner_email, project_id, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(state, ownerEmail, projectId, redirectUri, now + 10 * 60_000, new Date(now).toISOString()).run();
  return state;
}

export async function consumeOauthState(
  db: D1Database,
  state: string,
): Promise<{ ownerEmail: string; projectId: string; redirectUri: string } | null> {
  const row = await db.prepare(
    "SELECT owner_email, project_id, redirect_uri, expires_at FROM oauth_states WHERE state = ? LIMIT 1",
  ).bind(state).first<{ owner_email: string; project_id: string; redirect_uri: string; expires_at: number }>();
  await db.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!row || row.expires_at < Date.now()) return null;
  return { ownerEmail: row.owner_email, projectId: row.project_id, redirectUri: row.redirect_uri };
}

export async function getSearchConsoleConnection(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
): Promise<StoredSearchConsoleConnection | null> {
  const row = await db.prepare(
    `SELECT id, owner_email, project_id, site_url, encrypted_access_token, encrypted_refresh_token,
            token_expires_at, scope, created_at, updated_at
     FROM search_console_connections
     WHERE owner_email = ? AND project_id = ? LIMIT 1`,
  ).bind(ownerEmail, projectId).first<ConnectionRow>();
  return row ? fromConnectionRow(row) : null;
}

export async function upsertSearchConsoleConnection(
  db: D1Database,
  input: {
    ownerEmail: string;
    projectId: string;
    siteUrl?: string | null;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    tokenExpiresAt: number;
    scope: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getSearchConsoleConnection(db, input.ownerEmail, input.projectId);
  if (existing) {
    await db.prepare(
      `UPDATE search_console_connections
       SET site_url = COALESCE(?, site_url), encrypted_access_token = ?,
           encrypted_refresh_token = COALESCE(?, encrypted_refresh_token), token_expires_at = ?,
           scope = ?, updated_at = ?
       WHERE owner_email = ? AND project_id = ?`,
    ).bind(
      input.siteUrl ?? null,
      input.encryptedAccessToken,
      input.encryptedRefreshToken ?? null,
      input.tokenExpiresAt,
      input.scope,
      now,
      input.ownerEmail,
      input.projectId,
    ).run();
    return;
  }

  await db.prepare(
    `INSERT INTO search_console_connections
      (id, owner_email, project_id, site_url, encrypted_access_token, encrypted_refresh_token,
       token_expires_at, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.ownerEmail,
    input.projectId,
    input.siteUrl ?? null,
    input.encryptedAccessToken,
    input.encryptedRefreshToken ?? null,
    input.tokenExpiresAt,
    input.scope,
    now,
    now,
  ).run();
}

export async function setSearchConsoleSite(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
  siteUrl: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE search_console_connections SET site_url = ?, updated_at = ?
     WHERE owner_email = ? AND project_id = ?`,
  ).bind(siteUrl, new Date().toISOString(), ownerEmail, projectId).run();
  return Boolean(result.meta.changes);
}

export async function getSearchConsoleStatus(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
  configured: boolean,
): Promise<SearchConsoleConnectionStatus> {
  const connection = await getSearchConsoleConnection(db, ownerEmail, projectId);
  return {
    configured,
    connected: Boolean(connection),
    projectId,
    siteUrl: connection?.siteUrl || null,
    tokenExpiresAt: connection?.tokenExpiresAt || null,
    updatedAt: connection?.updatedAt || null,
  };
}

export async function deleteSearchConsoleConnection(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
): Promise<boolean> {
  const result = await db.prepare(
    "DELETE FROM search_console_connections WHERE owner_email = ? AND project_id = ?",
  ).bind(ownerEmail, projectId).run();
  return Boolean(result.meta.changes);
}

export async function saveSearchConsoleSnapshot(
  db: D1Database,
  ownerEmail: string,
  snapshot: SearchConsoleSnapshot,
): Promise<void> {
  await db.prepare(
    `INSERT INTO search_console_snapshots
      (id, owner_email, project_id, site_url, start_date, end_date, row_count,
       rows_json, opportunities_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    snapshot.id,
    ownerEmail,
    snapshot.projectId,
    snapshot.siteUrl,
    snapshot.startDate,
    snapshot.endDate,
    snapshot.rowCount,
    JSON.stringify(snapshot.rows),
    JSON.stringify(snapshot.opportunities),
    snapshot.createdAt,
  ).run();
}

export async function listSearchConsoleSnapshots(
  db: D1Database,
  ownerEmail: string,
  projectId: string,
): Promise<SearchConsoleSnapshot[]> {
  const result = await db.prepare(
    `SELECT id, project_id, site_url, start_date, end_date, row_count, rows_json,
            opportunities_json, created_at
     FROM search_console_snapshots
     WHERE owner_email = ? AND project_id = ?
     ORDER BY created_at DESC LIMIT 12`,
  ).bind(ownerEmail, projectId).all<SnapshotRow>();
  return (result.results || []).map(fromSnapshotRow);
}

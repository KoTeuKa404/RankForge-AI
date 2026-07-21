import type { MonitorCadence, MonitoringAlert, MonitoringConfig } from "../shared/types";
import { nextRunAt } from "./monitoring";

interface MonitorRow {
  id: string;
  project_id: string;
  name: string;
  root_url: string;
  max_pages: number;
  cadence: MonitorCadence;
  enabled: number;
  next_run_at: string;
  last_run_at: string | null;
  last_audit_id: string | null;
  last_status: MonitoringConfig["lastStatus"];
  last_error: string | null;
  created_at: string;
  updated_at: string;
  owner_email?: string;
}

interface AlertRow {
  id: string;
  monitor_id: string;
  audit_id: string | null;
  severity: MonitoringAlert["severity"];
  kind: MonitoringAlert["kind"];
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

function monitorFromRow(row: MonitorRow): MonitoringConfig {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    rootUrl: row.root_url,
    maxPages: row.max_pages,
    cadence: row.cadence,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastAuditId: row.last_audit_id,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function alertFromRow(row: AlertRow): MonitoringAlert {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    auditId: row.audit_id,
    severity: row.severity,
    kind: row.kind,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export async function createMonitor(
  db: D1Database,
  ownerEmail: string,
  input: { projectId: string; name: string; rootUrl: string; maxPages: number; cadence: MonitorCadence },
): Promise<MonitoringConfig> {
  const now = new Date();
  const monitor: MonitoringConfig = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    name: input.name,
    rootUrl: input.rootUrl,
    maxPages: input.maxPages,
    cadence: input.cadence,
    enabled: true,
    nextRunAt: now.toISOString(),
    lastRunAt: null,
    lastAuditId: null,
    lastStatus: "idle",
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.prepare(
    `INSERT INTO monitoring_configs
      (id, project_id, owner_email, name, root_url, max_pages, cadence, enabled, next_run_at, last_run_at, last_audit_id, last_status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, 'idle', NULL, ?, ?)`,
  ).bind(
    monitor.id,
    monitor.projectId,
    ownerEmail,
    monitor.name,
    monitor.rootUrl,
    monitor.maxPages,
    monitor.cadence,
    monitor.nextRunAt,
    monitor.createdAt,
    monitor.updatedAt,
  ).run();
  return monitor;
}

export async function listMonitors(db: D1Database, ownerEmail: string): Promise<MonitoringConfig[]> {
  const result = await db.prepare(
    `SELECT id, project_id, name, root_url, max_pages, cadence, enabled, next_run_at, last_run_at, last_audit_id, last_status, last_error, created_at, updated_at
     FROM monitoring_configs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 50`,
  ).bind(ownerEmail).all<MonitorRow>();
  return (result.results || []).map(monitorFromRow);
}

export async function getMonitor(db: D1Database, ownerEmail: string, id: string): Promise<MonitoringConfig | null> {
  const row = await db.prepare(
    `SELECT id, project_id, name, root_url, max_pages, cadence, enabled, next_run_at, last_run_at, last_audit_id, last_status, last_error, created_at, updated_at
     FROM monitoring_configs WHERE id = ? AND owner_email = ? LIMIT 1`,
  ).bind(id, ownerEmail).first<MonitorRow>();
  return row ? monitorFromRow(row) : null;
}

export async function setMonitorEnabled(db: D1Database, ownerEmail: string, id: string, enabled: boolean): Promise<MonitoringConfig | null> {
  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE monitoring_configs SET enabled = ?, next_run_at = CASE WHEN ? = 1 THEN ? ELSE next_run_at END, updated_at = ? WHERE id = ? AND owner_email = ?",
  ).bind(enabled ? 1 : 0, enabled ? 1 : 0, now, now, id, ownerEmail).run();
  return getMonitor(db, ownerEmail, id);
}

export interface DueMonitor extends MonitoringConfig {
  ownerEmail: string;
}

export async function claimDueMonitors(db: D1Database, limit = 2): Promise<DueMonitor[]> {
  const rows = await db.prepare(
    `SELECT id, project_id, owner_email, name, root_url, max_pages, cadence, enabled, next_run_at, last_run_at, last_audit_id, last_status, last_error, created_at, updated_at
     FROM monitoring_configs
     WHERE enabled = 1 AND next_run_at <= ? AND last_status != 'running'
     ORDER BY next_run_at ASC LIMIT ?`,
  ).bind(new Date().toISOString(), Math.max(1, Math.min(limit, 3))).all<MonitorRow>();
  const due = (rows.results || []).map((row) => ({ ...monitorFromRow(row), ownerEmail: row.owner_email || "" }));
  for (const monitor of due) {
    await db.prepare("UPDATE monitoring_configs SET last_status = 'running', updated_at = ? WHERE id = ? AND last_status != 'running'")
      .bind(new Date().toISOString(), monitor.id).run();
  }
  return due;
}

export async function beginMonitorRun(db: D1Database, ownerEmail: string, id: string): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE monitoring_configs SET last_status = 'running', last_error = NULL, updated_at = ? WHERE id = ? AND owner_email = ? AND last_status != 'running'",
  ).bind(new Date().toISOString(), id, ownerEmail).run();
  return Number(result.meta.changes || 0) > 0;
}

export async function completeMonitorRun(
  db: D1Database,
  monitor: Pick<MonitoringConfig, "id" | "cadence">,
  result: { auditId: string | null; status: "success" | "failed"; error?: string | null },
): Promise<void> {
  const now = new Date();
  await db.prepare(
    `UPDATE monitoring_configs
     SET last_run_at = ?, last_audit_id = COALESCE(?, last_audit_id), last_status = ?, last_error = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    now.toISOString(),
    result.auditId,
    result.status,
    result.error || null,
    nextRunAt(monitor.cadence, now),
    now.toISOString(),
    monitor.id,
  ).run();
}

export async function saveMonitoringAlerts(db: D1Database, ownerEmail: string, alerts: MonitoringAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  const statements = alerts.map((item) => db.prepare(
    `INSERT INTO monitoring_alerts
      (id, monitor_id, owner_email, audit_id, severity, kind, title, message, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(item.id, item.monitorId, ownerEmail, item.auditId, item.severity, item.kind, item.title, item.message, item.createdAt));
  await db.batch(statements);
}

export async function listMonitoringAlerts(db: D1Database, ownerEmail: string): Promise<MonitoringAlert[]> {
  const result = await db.prepare(
    `SELECT id, monitor_id, audit_id, severity, kind, title, message, created_at, read_at
     FROM monitoring_alerts WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(ownerEmail).all<AlertRow>();
  return (result.results || []).map(alertFromRow);
}

export async function markAlertRead(db: D1Database, ownerEmail: string, id: string): Promise<boolean> {
  const result = await db.prepare("UPDATE monitoring_alerts SET read_at = COALESCE(read_at, ?) WHERE id = ? AND owner_email = ?")
    .bind(new Date().toISOString(), id, ownerEmail).run();
  return Number(result.meta.changes || 0) > 0;
}

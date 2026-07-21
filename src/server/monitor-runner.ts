import type { MonitorRunResult, MonitoringConfig } from "../shared/types";
import { auditSite } from "./audit";
import { compareAudits } from "./compare";
import { getLatestComparableAudit, saveAudit } from "./db";
import { buildMonitoringAlerts } from "./monitoring";
import { completeMonitorRun, saveMonitoringAlerts } from "./monitoring-db";

export async function runMonitor(db: D1Database, ownerEmail: string, monitor: MonitoringConfig): Promise<MonitorRunResult> {
  const previousStatus = monitor.lastStatus;
  try {
    const previous = await getLatestComparableAudit(db, ownerEmail, monitor.projectId, monitor.rootUrl);
    const audit = await auditSite(monitor.rootUrl, { maxPages: monitor.maxPages });
    if (previous) audit.comparison = compareAudits(audit, previous);
    await saveAudit(db, ownerEmail, monitor.projectId, audit);
    const alerts = buildMonitoringAlerts(monitor.id, audit, previousStatus);
    await saveMonitoringAlerts(db, ownerEmail, alerts);
    await completeMonitorRun(db, monitor, { auditId: audit.id, status: "success" });
    return { monitor: { ...monitor, lastStatus: "success", lastAuditId: audit.id }, audit, alerts };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Scheduled crawl failed.";
    const failureAlert = {
      id: crypto.randomUUID(),
      monitorId: monitor.id,
      auditId: null,
      severity: "critical" as const,
      kind: "crawl_problem" as const,
      title: "Monitoring crawl failed",
      message,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    await saveMonitoringAlerts(db, ownerEmail, [failureAlert]);
    await completeMonitorRun(db, monitor, { auditId: null, status: "failed", error: message });
    return { monitor: { ...monitor, lastStatus: "failed", lastError: message }, audit: null, alerts: [failureAlert] };
  }
}

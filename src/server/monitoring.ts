import type {
  AuditResult,
  MonitorCadence,
  MonitoringAlert,
  MonitoringAlertSeverity,
} from "../shared/types";
import { TargetValidationError } from "./security";

const CADENCES = new Set<MonitorCadence>(["daily", "weekly", "monthly"]);

export function validateCadence(value: unknown): MonitorCadence {
  if (typeof value !== "string" || !CADENCES.has(value as MonitorCadence)) {
    throw new TargetValidationError("Monitoring cadence must be daily, weekly, or monthly.");
  }
  return value as MonitorCadence;
}

export function nextRunAt(cadence: MonitorCadence, from: Date = new Date()): string {
  const next = new Date(from);
  if (cadence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (cadence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

function alert(
  monitorId: string,
  auditId: string | null,
  severity: MonitoringAlertSeverity,
  kind: MonitoringAlert["kind"],
  title: string,
  message: string,
): MonitoringAlert {
  return {
    id: crypto.randomUUID(),
    monitorId,
    auditId,
    severity,
    kind,
    title,
    message,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
}

export function buildMonitoringAlerts(monitorId: string, audit: AuditResult, previousStatus?: "success" | "failed" | "idle" | "running"): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  const comparison = audit.comparison;

  if (audit.stoppedReason || audit.pagesScanned === 0) {
    alerts.push(alert(
      monitorId,
      audit.id,
      "critical",
      "crawl_problem",
      "Scheduled crawl did not complete normally",
      audit.stoppedReason || "No HTML pages were scanned.",
    ));
  }

  if (comparison?.scoreDelta !== undefined && comparison.scoreDelta <= -5) {
    alerts.push(alert(
      monitorId,
      audit.id,
      comparison.scoreDelta <= -15 ? "critical" : "warning",
      "score_drop",
      `SEO score dropped by ${Math.abs(comparison.scoreDelta)} points`,
      `The score changed from ${audit.score - comparison.scoreDelta} to ${audit.score}. Review new regressions before the next run.`,
    ));
  }

  const newCritical = comparison?.newIssues.filter((issue) => issue.severity === "critical") || [];
  const newHigh = comparison?.newIssues.filter((issue) => issue.severity === "high") || [];
  if (newCritical.length > 0) {
    alerts.push(alert(monitorId, audit.id, "critical", "new_critical", `${newCritical.length} new critical issue${newCritical.length === 1 ? "" : "s"}`, newCritical.slice(0, 4).map((issue) => issue.title).join("; ")));
  }
  if (newHigh.length > 0) {
    alerts.push(alert(monitorId, audit.id, "warning", "new_high", `${newHigh.length} new high-priority issue${newHigh.length === 1 ? "" : "s"}`, newHigh.slice(0, 4).map((issue) => issue.title).join("; ")));
  }

  if (previousStatus === "failed" && !audit.stoppedReason && audit.pagesScanned > 0) {
    alerts.push(alert(monitorId, audit.id, "info", "recovery", "Monitoring crawl recovered", `The scheduled crawl completed and scanned ${audit.pagesScanned} pages.`));
  }
  return alerts;
}

import type { AuditResult, SeoIssue } from "../shared/types";

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditIssuesCsv(audit: AuditResult): string {
  const header = ["status", "severity", "code", "title", "url", "evidence", "recommendation"];
  const newFingerprints = new Set((audit.comparison?.newIssues || []).map(issueKey));
  const rows = audit.issues.map((issue) => [
    newFingerprints.has(issueKey(issue)) ? "new" : "existing",
    issue.severity,
    issue.code,
    issue.title,
    issue.url || "",
    issue.evidence || "",
    issue.recommendation,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function issueKey(issue: SeoIssue): string {
  return `${issue.code}|${issue.url || "site-wide"}`;
}

import { describe, expect, it } from "vitest";
import { buildMonitoringAlerts, nextRunAt, validateCadence } from "../src/server/monitoring";
import { getIdentity } from "../src/server/env";
import type { AuditResult, SeoIssue } from "../src/shared/types";

function issue(severity: SeoIssue["severity"], title: string): SeoIssue {
  return { id: crypto.randomUUID(), code: title, severity, title, description: title, recommendation: title };
}

function audit(): AuditResult {
  return {
    id: "audit-2",
    rootUrl: "https://example.com/",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    score: 62,
    pagesScanned: 10,
    issues: [],
    pages: [],
    robotsTxtFound: true,
    sitemapFound: true,
    comparison: {
      previousAuditId: "audit-1",
      previousFinishedAt: new Date().toISOString(),
      scoreDelta: -18,
      trend: "declined",
      newIssues: [issue("critical", "Site-wide noindex"), issue("high", "Broken links")],
      fixedIssues: [],
      persistentIssueCount: 0,
      newPages: [],
      removedPages: [],
      changedPages: [],
    },
  };
}

describe("monitoring", () => {
  it("computes UTC-safe next run times", () => {
    const start = new Date("2026-01-31T10:00:00.000Z");
    expect(nextRunAt("daily", start)).toBe("2026-02-01T10:00:00.000Z");
    expect(nextRunAt("weekly", start)).toBe("2026-02-07T10:00:00.000Z");
    expect(nextRunAt("monthly", start)).toMatch(/^2026-03-0[23]T10:00:00.000Z$/);
  });

  it("emits regression alerts from real audit comparison data", () => {
    const alerts = buildMonitoringAlerts("monitor-1", audit());
    expect(alerts.some((item) => item.kind === "score_drop" && item.severity === "critical")).toBe(true);
    expect(alerts.some((item) => item.kind === "new_critical")).toBe(true);
    expect(alerts.some((item) => item.kind === "new_high")).toBe(true);
  });

  it("emits a recovery alert after a previously failed run", () => {
    const current = audit();
    current.comparison = undefined;
    const alerts = buildMonitoringAlerts("monitor-1", current, "failed");
    expect(alerts.some((item) => item.kind === "recovery")).toBe(true);
  });

  it("validates cadence values", () => {
    expect(validateCadence("weekly")).toBe("weekly");
    expect(() => validateCadence("hourly")).toThrow(/cadence/i);
  });

  it("allows local dev identity only on loopback hosts", () => {
    const env = { ENVIRONMENT: "development", DEV_USER_EMAIL: "dev@example.test" };
    expect(getIdentity(new Request("http://localhost/api/me"), env)?.email).toBe("dev@example.test");
    expect(getIdentity(new Request("https://public.example/api/me"), env)).toBeNull();
  });
});

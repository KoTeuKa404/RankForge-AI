import { describe, expect, it } from "vitest";
import { calculateAuditJobProgress } from "../src/server/audit-job-db";

describe("audit job progress", () => {
  it("reserves the initial range for discovery", () => {
    expect(calculateAuditJobProgress(0, 25, "discovering")).toBe(5);
  });

  it("increases as crawled pages are completed", () => {
    expect(calculateAuditJobProgress(5, 25, "crawling"))
      .toBeGreaterThan(calculateAuditJobProgress(1, 25, "crawling"));
    expect(calculateAuditJobProgress(20, 25, "crawling"))
      .toBeGreaterThan(calculateAuditJobProgress(5, 25, "crawling"));
  });

  it("reserves 100 percent for the completed state", () => {
    expect(calculateAuditJobProgress(25, 25, "finalizing")).toBe(95);
    expect(calculateAuditJobProgress(100, 25, "finalizing")).toBe(95);
  });
});

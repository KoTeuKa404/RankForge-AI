import { describe, expect, it } from "vitest";
import { calculateAuditJobProgress } from "../src/server/audit-job-db";

describe("audit job progress", () => {
  it("starts above zero while a job is running", () => {
    expect(calculateAuditJobProgress(0, 25)).toBe(5);
  });

  it("increases as pages are completed", () => {
    expect(calculateAuditJobProgress(5, 25)).toBeGreaterThan(calculateAuditJobProgress(1, 25));
    expect(calculateAuditJobProgress(20, 25)).toBeGreaterThan(calculateAuditJobProgress(5, 25));
  });

  it("reserves 100 percent for the completed state", () => {
    expect(calculateAuditJobProgress(25, 25)).toBe(95);
    expect(calculateAuditJobProgress(100, 25)).toBe(95);
  });
});

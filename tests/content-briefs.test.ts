import { describe, expect, it } from "vitest";
import { generateContentBrief, sanitizeContentBrief } from "../src/server/content-briefs";
import type { KeywordCluster } from "../src/shared/types";

function cluster(overrides: Partial<KeywordCluster> = {}): KeywordCluster {
  return {
    id: "cluster-1",
    name: "Technical SEO audit",
    primaryKeyword: "technical SEO audit",
    intent: "commercial",
    pageType: "comparison",
    suggestedSlug: "/technical-seo-audit/",
    confidence: 80,
    keywords: ["technical SEO audit", "website SEO audit", "best SEO audit tools"],
    ...overrides,
  };
}

describe("content briefs", () => {
  it("generates a complete deterministic brief from a keyword cluster", () => {
    const brief = generateContentBrief(cluster(), { projectId: "project-1", sourceAnalysisId: "analysis-1" });
    expect(brief.primaryKeyword).toBe("technical SEO audit");
    expect(brief.projectId).toBe("project-1");
    expect(brief.sourceAnalysisId).toBe("analysis-1");
    expect(brief.status).toBe("draft");
    expect(brief.outline.length).toBeGreaterThanOrEqual(5);
    expect(brief.schemaTypes).toContain("Article");
    expect(brief.qualityChecklist.some((item) => /human reviewer/i.test(item))).toBe(true);
    expect(brief.title.length).toBeLessThanOrEqual(60);
    expect(brief.metaDescription.length).toBeLessThanOrEqual(155);
  });

  it("uses conversion-oriented structure for landing pages", () => {
    const brief = generateContentBrief(cluster({ intent: "transactional", pageType: "landing" }));
    expect(brief.schemaTypes).toContain("Service");
    expect(brief.outline.some((item) => /pricing/i.test(item.heading))).toBe(true);
    expect(brief.outline.some((item) => /next step/i.test(item.heading))).toBe(true);
  });

  it("sanitizes editable fields and preserves server-owned identifiers", () => {
    const existing = generateContentBrief(cluster());
    const updated = sanitizeContentBrief({
      ...existing,
      id: "attacker-controlled",
      status: "approved",
      title: "  Updated   title  ",
      questions: ["Question one?", "question one?", "Question two?"],
    }, existing);
    expect(updated.id).toBe(existing.id);
    expect(updated.status).toBe("approved");
    expect(updated.title).toBe("Updated title");
    expect(updated.questions).toHaveLength(2);
  });

  it("rejects empty required editor fields", () => {
    const existing = generateContentBrief(cluster());
    expect(() => sanitizeContentBrief({ title: "   " }, existing)).toThrow(/title is required/i);
  });
});

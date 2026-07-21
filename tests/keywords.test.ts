import { describe, expect, it } from "vitest";
import { analyzeKeywords, classifyIntent, pageTypeForIntent } from "../src/server/keywords";

function findClusterKeyword(analysis: ReturnType<typeof analyzeKeywords>, keyword: string): string | undefined {
  const item = analysis.keywords.find((candidate) => candidate.keyword === keyword);
  return item?.clusterId;
}

describe("keyword intelligence", () => {
  it("classifies common search intents without external metrics", () => {
    expect(classifyIntent("how to automate SEO reports")).toBe("informational");
    expect(classifyIntent("best technical seo tools")).toBe("commercial");
    expect(classifyIntent("python automation services price")).toBe("transactional");
    expect(classifyIntent("RankForge official website")).toBe("navigational");
    expect(classifyIntent("seo consultant in lviv")).toBe("local");
    expect(pageTypeForIntent("transactional")).toBe("landing");
  });

  it("accepts CSV headers, trims values and removes normalized duplicates", () => {
    const result = analyzeKeywords([
      "keyword,volume",
      '"Technical SEO Audit",100',
      "technical seo audit,200",
      "technical seo audit checklist,80",
      "best technical seo audit tools,50",
    ].join("\n"));

    expect(result.inputCount).toBe(4);
    expect(result.uniqueCount).toBe(3);
    expect(result.keywords.map((item) => item.keyword)).toContain("Technical SEO Audit");
  });

  it("clusters closely related queries and creates usable page recommendations", () => {
    const result = analyzeKeywords([
      "technical seo audit",
      "technical seo audit checklist",
      "best technical seo audit tools",
      "python automation services",
      "hire python automation consultant",
    ].join("\n"));

    const auditCluster = findClusterKeyword(result, "technical seo audit");
    expect(auditCluster).toBeTruthy();
    expect(findClusterKeyword(result, "technical seo audit checklist")).toBe(auditCluster);

    const cluster = result.clusters.find((candidate) => candidate.id === auditCluster);
    expect(cluster?.suggestedSlug).toMatch(/^\/.+\/$/);
    expect(cluster?.confidence).toBeGreaterThanOrEqual(45);
  });

  it("does not fabricate search volume or keyword difficulty", () => {
    const result = analyzeKeywords("seo audit\nseo audit guide");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/searchVolume|keywordDifficulty|\"volume\"|\"kd\"/i);
  });

  it("rejects oversized batches", () => {
    const input = Array.from({ length: 4 }, (_, index) => `keyword ${index}`).join("\n");
    expect(() => analyzeKeywords(input, { maxKeywords: 3 })).toThrow(/maximum of 3 keywords/i);
  });
});

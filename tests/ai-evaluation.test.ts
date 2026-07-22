import { describe, expect, it } from "vitest";
import { evaluateAiFix } from "../src/server/ai-evaluation";
import { cosineSimilarity } from "../src/server/embeddings";


describe("AI recommendation quality gate", () => {
  it("accepts implementation-ready conservative guidance", () => {
    const result = evaluateAiFix({
      summary: "Add one descriptive H1 that reflects the main purpose of each affected page.",
      whyItMatters: "A clear primary heading improves document structure and helps users understand page intent.",
      implementation: "Update the shared template to render a page-specific heading value. Use the catalogue name for listing pages and the product name for detail pages.",
      code: "<h1>{{ pageTitle }}</h1>",
      verification: [
        "Inspect the rendered HTML and confirm exactly one H1 exists.",
        "Re-run the crawl and confirm the missing-H1 finding is resolved.",
      ],
      provider: "gemini",
    }, {
      id: "issue-1",
      code: "h1-missing",
      severity: "high",
      title: "Missing H1",
      description: "The page has no H1.",
      recommendation: "Add a clear primary heading.",
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("rejects manipulative or guaranteed-ranking guidance", () => {
    const result = evaluateAiFix({
      summary: "Guarantee rankings immediately.",
      whyItMatters: "This will rank #1 and create instant traffic for every page.",
      implementation: "Keyword stuff the page and buy backlinks to guarantee first page results.",
      verification: ["Check rank", "Wait"],
      provider: "gemini",
    });
    expect(result.passed).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/guarantee|manipulative/i);
  });
});

describe("semantic similarity", () => {
  it("returns one for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 8);
  });

  it("separates orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 8);
  });

  it("returns zero for invalid dimensions", () => {
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

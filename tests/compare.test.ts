import { describe, expect, it } from "vitest";
import { compareAudits, issueFingerprint } from "../src/server/compare";
import type { AuditResult, PageAudit, SeoIssue } from "../src/shared/types";

function page(url: string, overrides: Partial<PageAudit> = {}): PageAudit {
  return {
    url,
    status: 200,
    contentType: "text/html",
    loadTimeMs: 100,
    title: "Title",
    description: "Description",
    canonical: url,
    robots: "index,follow",
    lang: "en",
    h1: ["Heading"],
    headingCount: 1,
    wordCount: 300,
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinks: [],
    externalLinks: [],
    schemaCount: 0,
    ogTitle: "Title",
    ogDescription: "Description",
    incomingLinks: 1,
    ...overrides,
  };
}

function issue(code: string, url: string): SeoIssue {
  return { id: crypto.randomUUID(), code, url, severity: "high", title: code, description: code, recommendation: code };
}

function audit(id: string, score: number, issues: SeoIssue[], pages: PageAudit[]): AuditResult {
  return {
    id,
    rootUrl: "https://example.com/",
    startedAt: "2026-07-21T10:00:00.000Z",
    finishedAt: "2026-07-21T10:01:00.000Z",
    score,
    pagesScanned: pages.length,
    issues,
    pages,
    robotsTxtFound: true,
    sitemapFound: true,
  };
}

describe("audit comparison", () => {
  it("normalizes issue URLs for stable fingerprints", () => {
    expect(issueFingerprint(issue("title-missing", "https://example.com/about/")))
      .toBe(issueFingerprint(issue("title-missing", "https://example.com/about")));
  });

  it("detects new, fixed and changed records", () => {
    const previous = audit("before", 70, [issue("title-missing", "https://example.com/a")], [page("https://example.com/a")]);
    const current = audit("after", 80, [issue("description-missing", "https://example.com/a")], [page("https://example.com/a", { title: "Changed" }), page("https://example.com/b")]);
    const result = compareAudits(current, previous);
    expect(result.scoreDelta).toBe(10);
    expect(result.trend).toBe("improved");
    expect(result.newIssues).toHaveLength(1);
    expect(result.fixedIssues).toHaveLength(1);
    expect(result.newPages).toContain("https://example.com/b");
    expect(result.changedPages[0].fields).toContain("title");
  });
});

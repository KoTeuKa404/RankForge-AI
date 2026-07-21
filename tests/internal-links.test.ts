import { describe, expect, it } from "vitest";
import { analyzeInternalLinks } from "../src/server/internal-links";
import type { AuditResult, PageAudit } from "../src/shared/types";

function page(url: string, title: string, incomingLinks: number, internalLinks: string[] = []): PageAudit {
  return {
    url,
    status: 200,
    contentType: "text/html",
    loadTimeMs: 100,
    title,
    description: `${title} description`,
    canonical: url,
    robots: "index,follow",
    lang: "en",
    h1: [title],
    headingCount: 3,
    wordCount: 500,
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinks,
    externalLinks: [],
    schemaCount: 1,
    ogTitle: title,
    ogDescription: `${title} description`,
    incomingLinks,
  };
}

function audit(pages: PageAudit[]): AuditResult {
  return {
    id: "audit-1",
    rootUrl: "https://example.com/",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    score: 80,
    pagesScanned: pages.length,
    pages,
    issues: [],
    robotsTxtFound: true,
    sitemapFound: true,
  };
}

describe("internal linking agent", () => {
  it("finds contextual sources for an orphan page", () => {
    const result = analyzeInternalLinks(audit([
      page("https://example.com/", "SEO automation platform", 4),
      page("https://example.com/guides/technical-seo/", "Technical SEO guide and audit workflow", 3),
      page("https://example.com/tools/seo-audit/", "Technical SEO audit tool", 0),
    ]));
    expect(result.orphanPages).toContain("https://example.com/tools/seo-audit/");
    const suggestion = result.suggestions.find((item) => item.targetUrl.includes("seo-audit"));
    expect(suggestion?.sourceUrl).toContain("technical-seo");
    expect(suggestion?.anchorText).toBe("Technical SEO audit tool");
  });

  it("does not suggest a link that already exists", () => {
    const target = "https://example.com/tools/seo-audit/";
    const result = analyzeInternalLinks(audit([
      page("https://example.com/", "SEO automation", 3),
      page("https://example.com/technical-seo/", "Technical SEO audit guide", 2, [target]),
      page(target, "Technical SEO audit tool", 1),
    ]));
    expect(result.suggestions.some((item) => item.sourceUrl.includes("technical-seo") && item.targetUrl === target)).toBe(false);
  });

  it("excludes noindex targets", () => {
    const hidden = page("https://example.com/private-seo/", "Private SEO audit", 0);
    hidden.robots = "noindex,nofollow";
    const result = analyzeInternalLinks(audit([page("https://example.com/", "SEO audit", 2), hidden]));
    expect(result.orphanPages).not.toContain(hidden.url);
    expect(result.suggestions.some((item) => item.targetUrl === hidden.url)).toBe(false);
  });
});

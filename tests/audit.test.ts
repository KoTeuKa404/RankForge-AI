import { describe, expect, it } from "vitest";
import { analyzeHtml, calculateScore, evaluatePage, groupIssues } from "../src/server/audit";
import { canonicalizeCrawlUrl, normalizeTargetUrl, TargetValidationError } from "../src/server/security";

describe("target validation", () => {
  it("normalizes a public hostname", () => {
    expect(normalizeTargetUrl("example.com/path#section").toString()).toBe("https://example.com/path");
  });

  it.each(["http://localhost", "http://127.0.0.1", "http://10.0.0.4", "http://192.168.1.2", "http://[::1]", "https://example.com:8443"])("blocks unsafe target %s", (target: string) => {
    expect(() => normalizeTargetUrl(target)).toThrow(TargetValidationError);
  });

  it("removes tracking parameters and sorts meaningful parameters", () => {
    const base = new URL("https://example.com/");
    expect(canonicalizeCrawlUrl("/products?utm_source=test&B=2&a=1&fbclid=x", base))
      .toBe("https://example.com/products?B=2&a=1");
  });

  it("rejects query traps with excessive parameters", () => {
    const base = new URL("https://example.com/");
    const query = Array.from({ length: 13 }, (_, index) => `p${index}=x`).join("&");
    expect(canonicalizeCrawlUrl(`/products?${query}`, base)).toBeNull();
  });
});

describe("HTML analysis", () => {
  it("extracts SEO fields", () => {
    const page = analyzeHtml(`<!doctype html><html lang="en"><head><title>A useful example page title</title><meta name="description" content="A sufficiently detailed description that helps a searcher understand this example page before visiting it."><link rel="canonical" href="https://example.com/"><meta property="og:title" content="Example"><meta property="og:description" content="Example description"></head><body><h1>Example page</h1><p>${"useful content ".repeat(90)}</p><img src="x.jpg" alt="Example"><a href="/about">About</a></body></html>`, "https://example.com/");
    expect(page.title).toContain("useful example");
    expect(page.h1).toEqual(["Example page"]);
    expect(page.imagesMissingAlt).toBe(0);
    expect(page.internalLinks).toContain("https://example.com/about");
    expect(page.wordCount).toBeGreaterThan(150);
  });

  it("does not count script or style source as visible content", () => {
    const page = analyzeHtml(`<html><body><p>Visible words only</p><script>${"hidden script words ".repeat(200)}</script><style>${"hidden style words ".repeat(200)}</style></body></html>`, "https://example.com/");
    expect(page.wordCount).toBe(3);
  });

  it("accepts an empty alt attribute for decorative images", () => {
    const page = analyzeHtml(`<html><body><img src="decorative.svg" alt=""><img src="missing.png"></body></html>`, "https://example.com/");
    expect(page.imagesMissingAlt).toBe(1);
  });

  it("finds missing essentials", () => {
    const page = analyzeHtml("<html><body><img src='x.png'><p>tiny</p></body></html>", "https://example.com/");
    const codes = evaluatePage(page).map((issue) => issue.code);
    expect(codes).toContain("title-missing");
    expect(codes).toContain("description-missing");
    expect(codes).toContain("h1-missing");
    expect(codes).toContain("canonical-missing");
    expect(codes).toContain("image-alt-missing");
  });

  it("groups repeated template issues into one backlog item", () => {
    const issues = ["a", "b", "c"].flatMap((slug) => evaluatePage(analyzeHtml("<html><body>tiny</body></html>", `https://example.com/${slug}`)))
      .filter((issue) => issue.code === "h1-missing");
    const grouped = groupIssues(issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].description).toContain("3 crawled pages");
    expect(grouped[0].evidence).toContain("https://example.com/a");
    expect(grouped[0].evidence).toContain("https://example.com/c");
  });

  it("uses diminishing penalties for repeated site-template problems", () => {
    const issues = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      code: "h1-missing",
      severity: "high" as const,
      title: "Missing H1",
      description: "Missing H1",
      recommendation: "Add H1",
      url: `https://example.com/${index}`,
    }));
    expect(calculateScore(issues, 25)).toBeGreaterThanOrEqual(80);
  });

  it("keeps score within bounds", () => {
    const page = analyzeHtml("<html><body>tiny</body></html>", "https://example.com/");
    const score = calculateScore([...evaluatePage(page), ...evaluatePage(page), ...evaluatePage(page)]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

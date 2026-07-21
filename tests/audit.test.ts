import { describe, expect, it } from "vitest";
import { analyzeHtml, calculateScore, evaluatePage } from "../src/server/audit";
import { normalizeTargetUrl, TargetValidationError } from "../src/server/security";

describe("target validation", () => {
  it("normalizes a public hostname", () => {
    expect(normalizeTargetUrl("example.com/path#section").toString()).toBe("https://example.com/path");
  });

  it.each(["http://localhost", "http://127.0.0.1", "http://10.0.0.4", "http://192.168.1.2", "http://[::1]", "https://example.com:8443"])("blocks unsafe target %s", (target) => {
    expect(() => normalizeTargetUrl(target)).toThrow(TargetValidationError);
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

  it("finds missing essentials", () => {
    const page = analyzeHtml("<html><body><img src='x.png'><p>tiny</p></body></html>", "https://example.com/");
    const codes = evaluatePage(page).map((issue) => issue.code);
    expect(codes).toContain("title-missing");
    expect(codes).toContain("description-missing");
    expect(codes).toContain("h1-missing");
    expect(codes).toContain("canonical-missing");
    expect(codes).toContain("image-alt-missing");
  });

  it("keeps score within bounds", () => {
    const page = analyzeHtml("<html><body>tiny</body></html>", "https://example.com/");
    const score = calculateScore([...evaluatePage(page), ...evaluatePage(page), ...evaluatePage(page)]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

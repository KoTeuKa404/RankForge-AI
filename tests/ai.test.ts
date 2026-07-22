import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiFix, getAiProviderStatus } from "../src/server/ai";
import type { SeoIssue } from "../src/shared/types";

const issue: SeoIssue = {
  id: "issue-1",
  code: "title-missing",
  severity: "high",
  title: "Missing title",
  description: "The page has no title.",
  recommendation: "Add a useful title.",
  url: "https://example.com/",
};

const fix = {
  summary: "Add a descriptive title.",
  whyItMatters: "The title helps users and search engines understand the page.",
  implementation: "Add a unique title element in the document head.",
  code: "<title>Example</title>",
  verification: ["Reload the page", "Inspect the title element"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI provider selection", () => {
  it("detects Gemini as the available provider", () => {
    expect(getAiProviderStatus({ GEMINI_API_KEY: "gem-key" })).toEqual({
      enabled: true,
      mode: "auto",
      available: ["gemini"],
      preferred: "gemini",
    });
  });

  it("uses Gemini generateContent with structured JSON output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/models/gemini-3.5-flash:generateContent");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-api-key")).toBe("gem-key");
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(fix) }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiFix({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gem-key",
      GEMINI_MODEL: "gemini-3.5-flash",
    }, issue, undefined, "user:test");

    expect(result).toEqual(fix);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Gemini in auto mode when OpenAI fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(fix) }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiFix({
      AI_PROVIDER: "auto",
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "gpt-5",
      GEMINI_API_KEY: "gem-key",
    }, issue, undefined, "user:test");

    expect(result.summary).toBe(fix.summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("generativelanguage.googleapis.com");
  });

  it("requires the key for an explicitly selected provider", async () => {
    await expect(generateAiFix({ AI_PROVIDER: "gemini" }, issue, undefined, "user:test"))
      .rejects.toThrow("GEMINI_API_KEY");
  });
});

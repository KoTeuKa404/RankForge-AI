import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("accessibility contracts", () => {
  it("provides document language, viewport, description, and title", () => {
    const html = source("index.html");
    expect(html).toMatch(/<html\s+lang="en"/i);
    expect(html).toMatch(/name="viewport"/i);
    expect(html).toMatch(/name="description"/i);
    expect(html).toMatch(/<title>[^<]+<\/title>/i);
  });

  it("labels modal dialogs and close controls", () => {
    const app = source("src/client/App.tsx");
    expect(app).toContain('role="dialog"');
    expect(app).toContain('aria-modal="true"');
    expect(app).toContain('aria-label="Close"');
  });

  it("keeps keyboard-native controls for primary actions", () => {
    const app = source("src/client/App.tsx");
    const search = source("src/client/SearchConsoleWorkspace.tsx");
    expect(app).toContain("<button");
    expect(app).toContain("<form");
    expect(search).toContain("<select");
    expect(search).toContain("<button");
  });

  it("does not embed credential-shaped values in client code", () => {
    const client = [
      source("src/client/api.ts"),
      source("src/client/App.tsx"),
      source("src/client/SearchConsoleWorkspace.tsx"),
    ].join("\n");
    expect(client).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(client).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    expect(client).not.toMatch(/client_secret\s*[:=]\s*["'][^"']{12,}/i);
  });
});

import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import app from "../src/client/App.tsx?raw";
import api from "../src/client/api.ts?raw";
import search from "../src/client/SearchConsoleWorkspace.tsx?raw";


describe("accessibility contracts", () => {
  it("provides document language, viewport, description, and title", () => {
    expect(html).toMatch(/<html\s+lang="en"/i);
    expect(html).toMatch(/name="viewport"/i);
    expect(html).toMatch(/name="description"/i);
    expect(html).toMatch(/<title>[^<]+<\/title>/i);
  });

  it("labels modal dialogs and close controls", () => {
    expect(app).toContain('role="dialog"');
    expect(app).toContain('aria-modal="true"');
    expect(app).toContain('aria-label="Close"');
  });

  it("keeps keyboard-native controls for primary actions", () => {
    expect(app).toContain("<button");
    expect(app).toContain("<form");
    expect(search).toContain("<select");
    expect(search).toContain("<button");
  });

  it("does not embed credential-shaped values in client code", () => {
    const client = [api, app, search].join("\n");
    expect(client).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(client).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    expect(client).not.toMatch(/client_secret\s*[:=]\s*["'][^"']{12,}/i);
  });
});

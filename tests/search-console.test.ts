import { describe, expect, it } from "vitest";
import { buildSearchOpportunities } from "../src/server/gsc";
import { isBlockedResolvedAddress } from "../src/server/dns-security";
import { decryptSecret, encryptSecret } from "../src/server/secret-box";


describe("Search Console opportunities", () => {
  it("prioritizes striking-distance and low-CTR rows", () => {
    const opportunities = buildSearchOpportunities([
      {
        query: "technical seo audit",
        page: "https://example.com/audit",
        clicks: 3,
        impressions: 500,
        ctr: 0.006,
        position: 8.2,
      },
    ]);
    expect(opportunities.some((item) => item.kind === "striking-distance")).toBe(true);
    expect(opportunities.some((item) => item.kind === "low-ctr")).toBe(true);
    expect(opportunities[0].score).toBeGreaterThan(50);
  });

  it("ignores rows without enough evidence", () => {
    expect(buildSearchOpportunities([
      {
        query: "tiny sample",
        page: "https://example.com/",
        clicks: 0,
        impressions: 4,
        ctr: 0,
        position: 7,
      },
    ])).toEqual([]);
  });
});

describe("DNS target guard", () => {
  it("blocks private and documentation ranges", () => {
    expect(isBlockedResolvedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedResolvedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedResolvedAddress("192.168.1.5")).toBe(true);
    expect(isBlockedResolvedAddress("203.0.113.9")).toBe(true);
    expect(isBlockedResolvedAddress("::1")).toBe(true);
    expect(isBlockedResolvedAddress("2001:db8::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedResolvedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedResolvedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedResolvedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("encrypted OAuth tokens", () => {
  it("round-trips without storing plaintext", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const encrypted = await encryptSecret("refresh-token-value", secret);
    expect(encrypted).not.toContain("refresh-token-value");
    await expect(decryptSecret(encrypted, secret)).resolves.toBe("refresh-token-value");
  });
});

const base = (process.env.RANKFORGE_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

async function json(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const health = await json("/api/health");
if (!health.response.ok || health.payload.ok !== true) {
  throw new Error(`Health check failed: ${health.response.status}`);
}
if (!String(health.payload.version || "").startsWith("1.0.0")) {
  throw new Error(`Unexpected release version: ${health.payload.version}`);
}
if (!health.payload.database) throw new Error("D1 binding is not available.");
if (!health.payload.reportStorage) throw new Error("R2 binding is not available.");
if (!health.payload.dnsPreflight) throw new Error("DNS preflight is not enabled.");

const me = await json("/api/me");
if (!me.response.ok || typeof me.payload.authenticated !== "boolean") {
  throw new Error("Identity endpoint failed.");
}

const blocked = await json("/api/audit-jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: "http://127.0.0.1", maxPages: 5 }),
});
if (blocked.response.status !== 400) {
  throw new Error(`SSRF smoke test expected 400, received ${blocked.response.status}`);
}

const page = await fetch(`${base}/`);
const html = await page.text();
if (!page.ok || !html.includes("id=\"root\"")) throw new Error("Frontend shell is not available.");

console.log("RankForge runtime smoke test passed.");
console.log(JSON.stringify(health.payload, null, 2));

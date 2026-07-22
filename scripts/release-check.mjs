import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function read(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing required file: ${path}`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function requireMatch(path, pattern, message) {
  const content = read(path);
  if (!pattern.test(content)) failures.push(`${path}: ${message}`);
}

const pkg = JSON.parse(read("package.json") || "{}");
if (!/^1\.0\.0(?:-rc\.\d+)?$/.test(pkg.version || "")) {
  failures.push("package.json: version must be 1.0.0 or 1.0.0-rc.N");
}

for (let index = 1; index <= 8; index += 1) {
  const prefix = String(index).padStart(4, "0");
  const known = [
    `${prefix}_initial.sql`,
    `${prefix}_audit_comparisons.sql`,
    `${prefix}_keyword_intelligence.sql`,
    `${prefix}_content_briefs.sql`,
    `${prefix}_internal_linking.sql`,
    `${prefix}_monitoring.sql`,
    `${prefix}_audit_jobs.sql`,
    `${prefix}_search_console_usage.sql`,
  ];
  if (!known.some((name) => existsSync(resolve(root, "migrations", name)))) {
    failures.push(`Missing migration with prefix ${prefix}`);
  }
}

requireMatch("wrangler.jsonc", /"binding"\s*:\s*"DB"/, "D1 DB binding is missing");
requireMatch("wrangler.jsonc", /"binding"\s*:\s*"FILES"/, "R2 FILES binding is missing");
requireMatch("wrangler.jsonc", /"binding"\s*:\s*"AUDIT_QUEUE"/, "Queue binding is missing");
requireMatch("wrangler.jsonc", /"crons"\s*:/, "scheduled maintenance trigger is missing");
requireMatch("src\/server\/worker\.ts", /async queue\(/, "Queue consumer handler is missing");
requireMatch("src\/server\/worker\.ts", /async scheduled\(/, "Scheduled handler is missing");
requireMatch("src\/server\/security\.ts", /assertPublicDnsTarget/, "DNS preflight is not wired into fetches");
requireMatch("src\/server\/gsc\.ts", /searchAnalytics\/query/, "Search Console query integration is missing");
requireMatch("src\/server\/semantic-links\.ts", /cosineSimilarity/, "Semantic link enhancement is missing");
requireMatch("index.html", /<html\s+lang="[^"]+"/i, "document language is missing");
requireMatch("index.html", /<meta\s+name="description"/i, "meta description is missing");
requireMatch("index.html", /application\/ld\+json/i, "SoftwareApplication schema is missing");
requireMatch(".dev.vars.example", /GSC_TOKEN_SECRET=/, "Search Console encryption secret template is missing");

if (existsSync(resolve(root, ".dev.vars"))) failures.push(".dev.vars must never be committed");

if (failures.length) {
  console.error("RankForge release contract failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RankForge ${pkg.version} release contract passed.`);

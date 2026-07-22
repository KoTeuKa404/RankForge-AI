import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempDir = join(root, ".sites-worker-build");
const outputDir = join(root, "dist", "server");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

const result = spawnSync(
  npx,
  [
    "wrangler",
    "deploy",
    "--dry-run",
    "--outdir",
    tempDir,
    "--config",
    "wrangler.sites.jsonc",
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Wrangler Sites bundle failed with exit code ${result.status ?? "unknown"}.`);
}

const outputs = (await readdir(tempDir, { recursive: true }))
  .filter((name) => typeof name === "string" && /\.(?:m?js)$/i.test(name));

if (outputs.length === 0) {
  throw new Error("Wrangler did not emit a JavaScript Worker bundle.");
}

const preferred = outputs.find((name) => /(?:worker|sites)/i.test(name)) || outputs[0];
await cp(join(tempDir, preferred), join(outputDir, "index.js"));
await rm(tempDir, { recursive: true, force: true });

console.log("Created ChatGPT Sites Worker entry at dist/server/index.js.");

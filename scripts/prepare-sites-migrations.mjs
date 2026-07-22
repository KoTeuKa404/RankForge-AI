import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = join(root, "migrations");
const outputDir = join(root, "drizzle");
const metaDir = join(outputDir, "meta");

const files = (await readdir(sourceDir))
  .filter((name) => /^\d{4}_.+\.sql$/i.test(name))
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  throw new Error("No SQL migrations were found in migrations/.");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(metaDir, { recursive: true });

const entries = [];
for (const [index, filename] of files.entries()) {
  const source = await readFile(join(sourceDir, filename), "utf8");
  const tag = basename(filename, ".sql");

  // Drizzle's D1 migrator splits migration files at this marker. Existing
  // migrations keep their SQL unchanged; markers are added only after a
  // semicolon that ends a line.
  const packed = source
    .trim()
    .replace(/;[\t ]*$/gm, ";\n--> statement-breakpoint")
    .replace(/(?:\n--> statement-breakpoint)+\s*$/, "")
    .concat("\n");

  await writeFile(join(outputDir, filename), packed, "utf8");
  entries.push({
    idx: index,
    version: "6",
    when: Date.UTC(2026, 0, 1) + index,
    tag,
    breakpoints: true,
  });
}

await writeFile(
  join(metaDir, "_journal.json"),
  `${JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared ${files.length} Sites-compatible D1 migrations in drizzle/.`);

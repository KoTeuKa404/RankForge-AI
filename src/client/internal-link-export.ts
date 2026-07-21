import type { InternalLinkAnalysis } from "../shared/types";

function cell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function internalLinksCsv(analysis: InternalLinkAnalysis): string {
  const rows = analysis.suggestions.map((item) => [
    item.status,
    item.confidence,
    item.score,
    item.sourceUrl,
    item.targetUrl,
    item.anchorText,
    item.reasons.join(" | "),
  ]);
  return [["status", "confidence", "score", "source_url", "target_url", "anchor_text", "reasons"], ...rows]
    .map((row) => row.map(cell).join(","))
    .join("\n");
}

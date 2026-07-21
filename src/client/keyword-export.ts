import type { KeywordAnalysis } from "../shared/types";

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function keywordAnalysisCsv(analysis: KeywordAnalysis): string {
  const clusterById = new Map(analysis.clusters.map((cluster) => [cluster.id, cluster]));
  const rows = analysis.keywords.map((keyword) => {
    const cluster = clusterById.get(keyword.clusterId);
    return [
      keyword.keyword,
      keyword.intent,
      keyword.pageType,
      keyword.priority,
      cluster?.name || "",
      cluster?.primaryKeyword || "",
      cluster?.suggestedSlug || "",
      cluster?.confidence || "",
    ];
  });
  return [
    ["keyword", "intent", "page_type", "priority", "cluster", "primary_keyword", "suggested_slug", "cluster_confidence"],
    ...rows,
  ].map((row) => row.map(csvCell).join(",")).join("\n");
}

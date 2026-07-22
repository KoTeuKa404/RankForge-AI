import type {
  AuditResult,
  InternalLinkAnalysis,
  InternalLinkSuggestion,
  PageAudit,
} from "../shared/types";
import type { Env } from "./env";
import { cosineSimilarity, embedTexts } from "./embeddings";
import { analyzeInternalLinks } from "./internal-links";

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return raw;
  }
}

function pageDocument(page: PageAudit): string {
  let path = page.url;
  try {
    path = decodeURIComponent(new URL(page.url).pathname.replace(/[\-_]/g, " "));
  } catch {
    // Keep the full URL as a fallback topic signal.
  }
  return [
    `title: ${page.title || "none"}`,
    `headings: ${page.h1.join(" | ") || "none"}`,
    `description: ${page.description || "none"}`,
    `path: ${path}`,
  ].join(" | ").slice(0, 12_000);
}

function indexable(page: PageAudit): boolean {
  return page.status >= 200 && page.status < 300 && !/noindex/i.test(page.robots || "");
}

function existingLinks(page: PageAudit): Set<string> {
  return new Set(page.internalLinks.map(normalizeUrl));
}

function anchorText(page: PageAudit): string {
  const value = page.h1[0] || page.title || new URL(page.url).pathname.split("/").filter(Boolean).pop() || "Learn more";
  return value.replace(/\s*[|—–-]\s*[^|—–]+$/, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

function confidence(score: number): InternalLinkSuggestion["confidence"] {
  return score >= 75 ? "high" : score >= 52 ? "medium" : "low";
}

export async function analyzeInternalLinksSemantic(
  env: Env,
  audit: AuditResult,
): Promise<InternalLinkAnalysis> {
  const base = analyzeInternalLinks(audit);
  if (!env.GEMINI_API_KEY) return base;

  const pages = audit.pages.filter(indexable).slice(0, 100);
  if (pages.length < 2) return base;

  try {
    const vectors = await embedTexts(
      env,
      pages.map(pageDocument),
      "task: semantic similarity for SEO pages",
      4,
    );
    const pageByUrl = new Map(pages.map((page) => [normalizeUrl(page.url), page]));
    const vectorByUrl = new Map(pages.map((page, index) => [normalizeUrl(page.url), vectors[index]]));

    const enhanced = base.suggestions.map((suggestion) => {
      const sourceVector = vectorByUrl.get(normalizeUrl(suggestion.sourceUrl));
      const targetVector = vectorByUrl.get(normalizeUrl(suggestion.targetUrl));
      if (!sourceVector || !targetVector) return suggestion;
      const similarity = Math.max(0, cosineSimilarity(sourceVector, targetVector));
      const semanticScore = Math.round(similarity * 100);
      const score = Math.min(100, Math.round(suggestion.score * 0.58 + semanticScore * 0.42));
      return {
        ...suggestion,
        score,
        confidence: confidence(score),
        reasons: [...suggestion.reasons, `Semantic similarity: ${semanticScore}/100.`],
      };
    });

    const existingPairs = new Set(enhanced.map((item) => `${normalizeUrl(item.sourceUrl)}|${normalizeUrl(item.targetUrl)}`));
    const targetUrls = new Set([...base.orphanPages, ...base.underlinkedPages].map(normalizeUrl));
    const semanticAdditions: InternalLinkSuggestion[] = [];

    for (const targetUrl of targetUrls) {
      const target = pageByUrl.get(targetUrl);
      const targetVector = vectorByUrl.get(targetUrl);
      if (!target || !targetVector) continue;
      const candidates = pages
        .filter((source) => normalizeUrl(source.url) !== targetUrl)
        .filter((source) => !existingLinks(source).has(targetUrl))
        .filter((source) => !existingPairs.has(`${normalizeUrl(source.url)}|${targetUrl}`))
        .map((source) => {
          const vector = vectorByUrl.get(normalizeUrl(source.url));
          const similarity = vector ? Math.max(0, cosineSimilarity(vector, targetVector)) : 0;
          return { source, similarity, score: Math.round(similarity * 100) };
        })
        .filter((item) => item.score >= 48)
        .sort((a, b) => b.score - a.score)
        .slice(0, target.incomingLinks === 0 ? 3 : 2);

      for (const candidate of candidates) {
        const score = Math.min(100, Math.round(candidate.score * 0.88 + (candidate.source.wordCount >= 150 ? 8 : 0)));
        semanticAdditions.push({
          id: crypto.randomUUID(),
          sourceUrl: candidate.source.url,
          targetUrl: target.url,
          anchorText: anchorText(target),
          score,
          confidence: confidence(score),
          reasons: [
            `Semantic similarity: ${candidate.score}/100.`,
            "The source does not already link to the target.",
            ...(candidate.source.wordCount >= 150 ? ["Source page has enough context for an editorial link."] : []),
          ],
          status: "proposed",
        });
      }
    }

    const suggestions = [...enhanced, ...semanticAdditions]
      .sort((a, b) => b.score - a.score || a.sourceUrl.localeCompare(b.sourceUrl))
      .slice(0, 200);
    const matchedTargets = new Set(suggestions.map((item) => normalizeUrl(item.targetUrl)));

    return {
      ...base,
      suggestions,
      skippedTargets: base.skippedTargets.filter((url) => !matchedTargets.has(normalizeUrl(url))),
      semanticEnhanced: true,
      semanticModel: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    };
  } catch (error) {
    console.warn("semantic_links_fallback", {
      message: error instanceof Error ? error.message : "Unknown embedding failure",
    });
    return base;
  }
}

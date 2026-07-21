import type { AuditResult, InternalLinkAnalysis, InternalLinkSuggestion, PageAudit } from "../shared/types";
import { TargetValidationError } from "./security";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "what", "with",
  "і", "й", "та", "або", "в", "у", "на", "до", "для", "з", "із", "як", "що", "це", "про",
  "и", "или", "в", "на", "до", "для", "с", "как", "что", "это", "про",
]);

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

function tokens(value: string): string[] {
  return [...value.normalize("NFKC").toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function pageTokens(page: PageAudit): string[] {
  let path = "";
  try {
    path = decodeURIComponent(new URL(page.url).pathname.replace(/[\-_]/g, " "));
  } catch {
    path = page.url;
  }
  return [...new Set(tokens([page.title, ...page.h1, path].join(" ")))];
}

function pathParent(raw: string): string {
  try {
    const parts = new URL(raw).pathname.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : "";
  } catch {
    return "";
  }
}

function anchorFor(page: PageAudit): string {
  const candidate = page.h1[0] || page.title || new URL(page.url).pathname.split("/").filter(Boolean).pop() || "Learn more";
  return candidate.replace(/\s*[|—–-]\s*[^|—–]+$/, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

function isIndexable(page: PageAudit): boolean {
  return page.status >= 200 && page.status < 300 && !/noindex/i.test(page.robots || "");
}

function existingTargets(page: PageAudit): Set<string> {
  return new Set(page.internalLinks.map(normalizeUrl));
}

function candidateScore(source: PageAudit, target: PageAudit): { score: number; reasons: string[] } {
  const sourceTokens = new Set(pageTokens(source));
  const targetTokens = pageTokens(target);
  const shared = targetTokens.filter((token) => sourceTokens.has(token));
  if (targetTokens.length === 0 || shared.length === 0) return { score: 0, reasons: [] };

  const targetCoverage = shared.length / targetTokens.length;
  const sharedParent = pathParent(source.url) && pathParent(source.url) === pathParent(target.url);
  const sourceHasDepth = source.wordCount >= 150;
  let score = Math.round(targetCoverage * 72);
  if (sharedParent) score += 12;
  if (sourceHasDepth) score += 8;
  if (source.internalLinks.length < 20) score += 5;
  score = Math.min(100, score);

  const reasons = [`Shared topic terms: ${shared.slice(0, 5).join(", ")}`];
  if (sharedParent) reasons.push("Pages are in the same top-level section.");
  if (sourceHasDepth) reasons.push("Source page has enough context for a natural in-content link.");
  return { score, reasons };
}

export function analyzeInternalLinks(audit: AuditResult): InternalLinkAnalysis {
  if (!audit || !Array.isArray(audit.pages) || audit.pages.length === 0) throw new TargetValidationError("The selected audit has no crawlable pages.");
  if (audit.pages.length > 2_000) throw new TargetValidationError("This internal linking analysis is limited to 2,000 pages.");

  const root = normalizeUrl(audit.rootUrl);
  const pages = audit.pages.filter(isIndexable);
  const normalized = new Map(pages.map((page) => [normalizeUrl(page.url), page]));
  const orphanPages = pages.filter((page) => normalizeUrl(page.url) !== root && page.incomingLinks === 0).map((page) => page.url);
  const underlinkedPages = pages.filter((page) => normalizeUrl(page.url) !== root && page.incomingLinks <= 1).map((page) => page.url);
  const suggestions: InternalLinkSuggestion[] = [];
  const skippedTargets: string[] = [];

  const targets = [...pages]
    .filter((page) => normalizeUrl(page.url) !== root && page.incomingLinks < 3)
    .sort((a, b) => a.incomingLinks - b.incomingLinks || b.wordCount - a.wordCount);

  for (const target of targets) {
    const targetUrl = normalizeUrl(target.url);
    const candidates = pages
      .filter((source) => normalizeUrl(source.url) !== targetUrl)
      .filter((source) => !existingTargets(source).has(targetUrl))
      .map((source) => ({ source, ...candidateScore(source, target) }))
      .filter((candidate) => candidate.score >= 28)
      .sort((a, b) => b.score - a.score || a.source.url.localeCompare(b.source.url))
      .slice(0, target.incomingLinks === 0 ? 3 : 2);

    if (candidates.length === 0) {
      skippedTargets.push(target.url);
      continue;
    }

    for (const candidate of candidates) {
      suggestions.push({
        id: crypto.randomUUID(),
        sourceUrl: candidate.source.url,
        targetUrl: target.url,
        anchorText: anchorFor(target),
        score: candidate.score,
        confidence: candidate.score >= 70 ? "high" : candidate.score >= 45 ? "medium" : "low",
        reasons: candidate.reasons,
        status: "proposed",
      });
      if (suggestions.length >= 200) break;
    }
    if (suggestions.length >= 200) break;
  }

  return {
    id: crypto.randomUUID(),
    projectId: null,
    auditId: audit.id,
    rootUrl: audit.rootUrl,
    createdAt: new Date().toISOString(),
    pageCount: normalized.size,
    orphanPages,
    underlinkedPages,
    suggestions,
    skippedTargets,
  };
}

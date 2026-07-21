import type {
  KeywordAnalysis,
  KeywordCluster,
  KeywordItem,
  KeywordOverlapWarning,
  KeywordPageType,
  SearchIntent,
} from "../shared/types";
import { TargetValidationError } from "./security";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "what", "with",
  "і", "й", "та", "або", "в", "у", "на", "до", "для", "з", "із", "як", "що", "це", "про",
  "и", "или", "в", "на", "до", "для", "с", "как", "что", "это", "про",
]);

const INTENT_TERMS: Record<SearchIntent, string[]> = {
  transactional: [
    "buy", "price", "pricing", "order", "hire", "service", "services", "agency", "consultant", "quote", "download",
    "купити", "ціна", "вартість", "замовити", "послуга", "послуги", "агенція", "консультант",
    "купить", "цена", "стоимость", "заказать", "услуга", "услуги", "агентство",
  ],
  commercial: [
    "best", "top", "review", "reviews", "compare", "comparison", "versus", "vs", "alternative", "alternatives", "software", "tool", "tools",
    "кращий", "кращі", "топ", "огляд", "відгуки", "порівняння", "альтернатива", "інструмент",
    "лучший", "лучшие", "обзор", "отзывы", "сравнение", "альтернатива", "инструмент",
  ],
  navigational: [
    "login", "signin", "official", "website", "dashboard", "github", "docs", "documentation", "support",
    "увійти", "офіційний", "сайт", "документація", "підтримка",
    "войти", "официальный", "сайт", "документация", "поддержка",
  ],
  local: [
    "near me", "nearby", "local", "in kyiv", "in lviv", "in ukraine",
    "поруч", "поблизу", "у києві", "у львові", "в україні",
    "рядом", "поблизости", "в киеве", "во львове", "в украине",
  ],
  informational: [
    "how", "what", "why", "when", "where", "guide", "tutorial", "example", "examples", "checklist", "meaning", "learn",
    "як", "що", "чому", "коли", "де", "гайд", "інструкція", "приклад", "чекліст", "навчитися",
    "как", "что", "почему", "когда", "где", "руководство", "инструкция", "пример", "чеклист",
  ],
};

interface ParsedKeyword {
  keyword: string;
  normalized: string;
  tokens: string[];
  intent: SearchIntent;
  pageType: KeywordPageType;
}

interface WorkingCluster {
  id: string;
  items: ParsedKeyword[];
  tokenFrequency: Map<string, number>;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === ";" || char === "\t") && !quoted) {
      fields.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value.trim());
  return fields;
}

function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0].toLocaleLowerCase())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function includesTerm(value: string, term: string): boolean {
  return term.includes(" ") ? value.includes(term) : tokenize(value).includes(term);
}

export function classifyIntent(keyword: string): SearchIntent {
  const normalized = normalizeKeyword(keyword);
  const order: SearchIntent[] = ["local", "transactional", "commercial", "navigational", "informational"];
  const scores = new Map<SearchIntent, number>();

  for (const intent of order) {
    const score = INTENT_TERMS[intent].reduce((total, term) => total + (includesTerm(normalized, term) ? 1 : 0), 0);
    scores.set(intent, score);
  }

  const best = order.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0))[0];
  return (scores.get(best) || 0) > 0 ? best : "informational";
}

export function pageTypeForIntent(intent: SearchIntent): KeywordPageType {
  if (intent === "transactional") return "landing";
  if (intent === "commercial") return "comparison";
  if (intent === "navigational") return "brand";
  if (intent === "local") return "local-landing";
  return "guide";
}

function similarity(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function clusterTokens(cluster: WorkingCluster): string[] {
  return [...cluster.tokenFrequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function addToCluster(cluster: WorkingCluster, item: ParsedKeyword): void {
  cluster.items.push(item);
  for (const token of new Set(item.tokens)) {
    cluster.tokenFrequency.set(token, (cluster.tokenFrequency.get(token) || 0) + 1);
  }
}

function choosePrimary(items: ParsedKeyword[]): ParsedKeyword {
  const intentWeight: Record<SearchIntent, number> = {
    transactional: 5,
    commercial: 4,
    local: 4,
    informational: 3,
    navigational: 2,
  };
  return [...items].sort((a, b) => {
    const scoreA = intentWeight[a.intent] * 10 + Math.min(a.tokens.length, 6) - Math.abs(a.keyword.length - 38) / 20;
    const scoreB = intentWeight[b.intent] * 10 + Math.min(b.tokens.length, 6) - Math.abs(b.keyword.length - 38) / 20;
    return scoreB - scoreA || a.keyword.localeCompare(b.keyword);
  })[0];
}

function dominantIntent(items: ParsedKeyword[]): SearchIntent {
  const counts = new Map<SearchIntent, number>();
  for (const item of items) counts.set(item.intent, (counts.get(item.intent) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "informational";
}

function slugify(value: string): string {
  const slug = normalizeKeyword(value)
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `/${slug || "topic"}/`;
}

function clusterName(cluster: WorkingCluster, primary: ParsedKeyword): string {
  const common = [...cluster.tokenFrequency.entries()]
    .filter(([, count]) => count >= Math.max(2, Math.ceil(cluster.items.length * 0.35)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([token]) => token);
  if (common.length === 0) return primary.keyword;
  return common.map((token) => token.charAt(0).toLocaleUpperCase() + token.slice(1)).join(" ");
}

function parseInput(raw: string, maxKeywords: number): { values: string[]; inputCount: number } {
  if (typeof raw !== "string" || !raw.trim()) throw new TargetValidationError("Paste keywords or upload CSV content first.");
  if (raw.length > 150_000) throw new TargetValidationError("Keyword input is too large.");

  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const values: string[] = [];
  for (const [index, line] of lines.entries()) {
    const fields = parseCsvLine(line);
    const candidate = fields[0]?.trim();
    if (!candidate) continue;
    if (index === 0 && /^(keyword|query|term|ключ|запит)$/i.test(candidate)) continue;
    values.push(candidate);
    if (values.length > maxKeywords) throw new TargetValidationError(`A maximum of ${maxKeywords} keywords can be analyzed at once.`);
  }
  return { values, inputCount: values.length };
}

export function analyzeKeywords(raw: string, options: { maxKeywords?: number; projectId?: string | null; name?: string } = {}): KeywordAnalysis {
  const maxKeywords = Math.max(1, Math.min(options.maxKeywords || 500, 2_000));
  const parsed = parseInput(raw, maxKeywords);
  const unique = new Map<string, string>();
  for (const keyword of parsed.values) {
    const normalized = normalizeKeyword(keyword);
    if (normalized.length < 2 || normalized.length > 200) continue;
    if (!unique.has(normalized)) unique.set(normalized, keyword.replace(/\s+/g, " ").trim());
  }
  if (unique.size === 0) throw new TargetValidationError("No valid keywords were found.");

  const items: ParsedKeyword[] = [...unique.entries()].map(([normalized, keyword]) => {
    const intent = classifyIntent(normalized);
    return { keyword, normalized, tokens: tokenize(normalized), intent, pageType: pageTypeForIntent(intent) };
  }).sort((a, b) => b.tokens.length - a.tokens.length || a.keyword.localeCompare(b.keyword));

  const clusters: WorkingCluster[] = [];
  for (const item of items) {
    let bestCluster: WorkingCluster | undefined;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = similarity(item.tokens, clusterTokens(cluster));
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }
    const exactContainment = bestCluster?.items.some((existing) =>
      existing.normalized.includes(item.normalized) || item.normalized.includes(existing.normalized),
    );
    if (bestCluster && (bestScore >= 0.34 || (bestScore >= 0.2 && exactContainment))) {
      addToCluster(bestCluster, item);
    } else {
      const cluster: WorkingCluster = { id: `cluster-${clusters.length + 1}`, items: [], tokenFrequency: new Map() };
      addToCluster(cluster, item);
      clusters.push(cluster);
    }
  }

  const outputClusters: KeywordCluster[] = clusters.map((cluster) => {
    const primary = choosePrimary(cluster.items);
    const intent = dominantIntent(cluster.items);
    const pairScores: number[] = [];
    for (let left = 0; left < cluster.items.length; left += 1) {
      for (let right = left + 1; right < cluster.items.length; right += 1) {
        pairScores.push(similarity(cluster.items[left].tokens, cluster.items[right].tokens));
      }
    }
    const confidence = pairScores.length
      ? Math.round((pairScores.reduce((sum, score) => sum + score, 0) / pairScores.length) * 100)
      : 100;
    return {
      id: cluster.id,
      name: clusterName(cluster, primary),
      primaryKeyword: primary.keyword,
      intent,
      pageType: pageTypeForIntent(intent),
      suggestedSlug: slugify(primary.keyword),
      confidence,
      keywords: cluster.items.map((item) => item.keyword).sort((a, b) => a.localeCompare(b)),
    };
  }).sort((a, b) => b.keywords.length - a.keywords.length || a.name.localeCompare(b.name));

  const clusterByKeyword = new Map<string, string>();
  outputClusters.forEach((cluster) => cluster.keywords.forEach((keyword) => clusterByKeyword.set(normalizeKeyword(keyword), cluster.id)));
  const outputItems: KeywordItem[] = items.map((item, index) => {
    const cluster = outputClusters.find((candidate) => candidate.id === clusterByKeyword.get(item.normalized));
    const clusterSize = cluster?.keywords.length || 1;
    const intentBoost: Record<SearchIntent, number> = { transactional: 25, commercial: 20, local: 18, informational: 12, navigational: 8 };
    return {
      id: `keyword-${index + 1}`,
      keyword: item.keyword,
      normalized: item.normalized,
      intent: item.intent,
      pageType: item.pageType,
      clusterId: cluster?.id || "cluster-unknown",
      priority: Math.min(100, 35 + intentBoost[item.intent] + Math.min(clusterSize * 4, 24) + Math.min(item.tokens.length * 2, 10)),
    };
  });

  const overlapWarnings: KeywordOverlapWarning[] = [];
  for (let left = 0; left < outputClusters.length; left += 1) {
    for (let right = left + 1; right < outputClusters.length; right += 1) {
      const a = outputClusters[left];
      const b = outputClusters[right];
      const score = similarity(tokenize(a.primaryKeyword), tokenize(b.primaryKeyword));
      if (score >= 0.3 && a.intent === b.intent) {
        overlapWarnings.push({
          clusterA: a.id,
          clusterB: b.id,
          similarity: Math.round(score * 100),
          reason: "Primary keywords share substantial vocabulary and the same search intent; review before creating separate pages.",
        });
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    projectId: options.projectId || null,
    name: options.name?.trim().slice(0, 80) || `Keyword analysis ${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    inputCount: parsed.inputCount,
    uniqueCount: unique.size,
    keywords: outputItems,
    clusters: outputClusters,
    overlapWarnings,
  };
}

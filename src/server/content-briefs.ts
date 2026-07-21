import type {
  ContentBrief,
  ContentBriefStatus,
  ContentOutlineSection,
  KeywordCluster,
  KeywordPageType,
  SearchIntent,
} from "../shared/types";
import { TargetValidationError } from "./security";

const STATUS_VALUES = new Set<ContentBriefStatus>(["draft", "review", "approved"]);
const INTENT_VALUES = new Set<SearchIntent>(["informational", "commercial", "transactional", "navigational", "local"]);
const PAGE_TYPE_VALUES = new Set<KeywordPageType>(["guide", "comparison", "landing", "brand", "local-landing"]);
const INTENT_LABELS: Record<SearchIntent, string> = {
  informational: "learn and complete a task",
  commercial: "compare options before making a decision",
  transactional: "choose a provider or take a conversion action",
  navigational: "reach the correct brand resource quickly",
  local: "find a relevant local provider and verify fit",
};

function cleanText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string") throw new TargetValidationError(`${field} must be text.`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new TargetValidationError(`${field} is required.`);
  if (cleaned.length > max) throw new TargetValidationError(`${field} is too long.`);
  return cleaned;
}

function uniqueStrings(values: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function titleCase(value: string): string {
  return value.replace(/(^|[\s\-–—])\p{L}/gu, (match) => match.toLocaleUpperCase());
}

function trimMeta(value: string, max: number): string {
  if (value.length <= max) return value;
  const truncated = value.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return `${truncated}…`;
}

function section(heading: string, purpose: string, level: 2 | 3 = 2): ContentOutlineSection {
  return { id: crypto.randomUUID(), level, heading, purpose };
}

function outlineFor(pageType: KeywordPageType, primary: string): ContentOutlineSection[] {
  const topic = titleCase(primary);
  if (pageType === "landing") return [
    section(`${topic}: outcome and value`, "State the problem, desired outcome, and who the offer is for."),
    section("What is included", "Describe concrete deliverables, scope boundaries, and prerequisites."),
    section("How the process works", "Explain the delivery process in clear, low-risk steps."),
    section("Why choose this approach", "Show differentiators with verifiable evidence, not unsupported claims."),
    section("Pricing and engagement factors", "Explain what affects cost without inventing unavailable prices."),
    section("Frequently asked questions", "Resolve objections and practical implementation questions."),
    section("Next step", "Provide one clear conversion action."),
  ];
  if (pageType === "comparison") return [
    section(`${topic}: quick recommendation`, "Give a concise answer and explain who each option suits."),
    section("Evaluation criteria", "Define transparent criteria before comparing options."),
    section("Feature-by-feature comparison", "Compare equivalent capabilities using consistent evidence."),
    section("Strengths and limitations", "Present trade-offs fairly and identify uncertainty."),
    section("Use-case recommendations", "Map different user needs to the best-fit option."),
    section("Frequently asked questions", "Answer decision-stage questions."),
  ];
  if (pageType === "local-landing") return [
    section(`${topic} in your area`, "Confirm service area and the exact local need addressed."),
    section("Services and outcomes", "Describe local services and realistic results."),
    section("How engagement works", "Explain response times, process, and requirements."),
    section("Local proof and trust", "Add only verifiable address, reviews, credentials, and case evidence."),
    section("Frequently asked questions", "Answer location, availability, and pricing-factor questions."),
    section("Contact and next step", "Provide a clear local conversion action."),
  ];
  if (pageType === "brand") return [
    section(`${topic} overview`, "Clarify the official resource and its primary purpose."),
    section("Key destinations", "Link users to the most important product, docs, login, and support pages."),
    section("Common tasks", "Help users complete frequent navigational goals quickly."),
    section("Support and verification", "Provide official contact and authenticity signals."),
  ];
  return [
    section(`What is ${primary}?`, "Define the topic precisely and set scope."),
    section("Why it matters", "Connect the topic to a concrete user problem or outcome."),
    section("How it works", "Explain the mechanism or workflow step by step."),
    section("Implementation guide", "Provide an actionable process with prerequisites and checks."),
    section("Common mistakes", "Explain failure modes and how to avoid them."),
    section("Examples and validation", "Use verifiable examples and show how to confirm results."),
    section("Frequently asked questions", "Answer adjacent questions without padding."),
  ];
}

function schemaFor(pageType: KeywordPageType): string[] {
  if (pageType === "landing") return ["Service", "FAQPage", "BreadcrumbList"];
  if (pageType === "comparison") return ["Article", "FAQPage", "BreadcrumbList"];
  if (pageType === "local-landing") return ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"];
  if (pageType === "brand") return ["Organization", "WebSite", "BreadcrumbList"];
  return ["Article", "FAQPage", "BreadcrumbList"];
}

function defaultQuestions(primary: string, intent: SearchIntent): string[] {
  const base = [
    `What is ${primary}?`,
    `How does ${primary} work?`,
    `What should be checked before using ${primary}?`,
  ];
  if (intent === "transactional") base.push(`How should a ${primary} provider be evaluated?`, `What affects the cost of ${primary}?`);
  if (intent === "commercial") base.push(`Which ${primary} option fits each use case?`, `What are the main trade-offs?`);
  if (intent === "local") base.push(`Is ${primary} available in the target area?`, `What local proof should be verified?`);
  return base;
}

export function generateContentBrief(
  cluster: KeywordCluster,
  options: { projectId?: string | null; sourceAnalysisId?: string | null; name?: string } = {},
): ContentBrief {
  const primaryKeyword = cleanText(cluster.primaryKeyword, "Primary keyword", 200);
  const supportingKeywords = uniqueStrings(cluster.keywords, 100, 200).filter((keyword) => keyword.toLocaleLowerCase() !== primaryKeyword.toLocaleLowerCase());
  if (!INTENT_VALUES.has(cluster.intent)) throw new TargetValidationError("Keyword cluster intent is invalid.");
  if (!PAGE_TYPE_VALUES.has(cluster.pageType)) throw new TargetValidationError("Keyword cluster page type is invalid.");
  const pageType = cluster.pageType;
  const intent = cluster.intent;
  const h1 = titleCase(primaryKeyword);
  const intentSummary = `The page should help users ${INTENT_LABELS[intent]}. It must satisfy that goal directly before adding supporting detail.`;
  const name = options.name ? cleanText(options.name, "Brief name", 100) : `${h1} content brief`;
  const titleSuffix = pageType === "comparison" ? "Comparison & Selection Guide" : pageType === "landing" ? "Services & Solutions" : "Practical Guide";

  return {
    id: crypto.randomUUID(),
    projectId: options.projectId || null,
    sourceAnalysisId: options.sourceAnalysisId || null,
    sourceClusterId: typeof cluster.id === "string" && cluster.id.length <= 120 ? cluster.id : null,
    name,
    primaryKeyword,
    supportingKeywords,
    intent,
    pageType,
    suggestedSlug: cleanText(cluster.suggestedSlug || "/topic/", "Suggested slug", 120),
    title: trimMeta(`${h1} — ${titleSuffix}`, 60),
    metaDescription: trimMeta(`Explore ${primaryKeyword}, key considerations, practical steps, and clear recommendations for making an informed decision.`, 155),
    h1,
    audience: `People searching for “${primaryKeyword}” who need a clear, trustworthy next step.`,
    searchIntentSummary: intentSummary,
    angle: "Lead with the direct answer, show the process transparently, separate evidence from assumptions, and finish with one relevant next action.",
    outline: outlineFor(pageType, primaryKeyword),
    questions: uniqueStrings([...defaultQuestions(primaryKeyword, intent), ...supportingKeywords.filter((keyword) => /^(how|what|why|when|where|як|що|чому|коли|де|как|что|почему)/i.test(keyword)).map((keyword) => `${keyword.replace(/[?]+$/, "")}?`)], 12, 220),
    internalLinkIdeas: supportingKeywords.slice(0, 8).map((keyword) => `Link to a dedicated page about “${keyword}” when one exists and is genuinely useful.`),
    schemaTypes: schemaFor(pageType),
    qualityChecklist: [
      "The opening answers the primary intent without a long preamble.",
      "Every factual or comparative claim has a verifiable source.",
      "The title, H1, and description are unique and accurately describe the page.",
      "Headings are descriptive and follow a logical H2/H3 hierarchy.",
      "Internal links use natural anchors and point to relevant pages only.",
      "Structured data matches visible content and Google eligibility rules.",
      "A human reviewer checks accuracy, usefulness, tone, and conversion claims before publishing.",
    ],
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeContentBrief(value: unknown, existing: ContentBrief): ContentBrief {
  if (!value || typeof value !== "object") throw new TargetValidationError("A valid content brief is required.");
  const input = value as Partial<ContentBrief>;
  const status = input.status && STATUS_VALUES.has(input.status) ? input.status : existing.status;
  const outline = Array.isArray(input.outline) ? input.outline.slice(0, 30).map((item) => ({
    id: typeof item?.id === "string" ? item.id : crypto.randomUUID(),
    level: item?.level === 3 ? 3 as const : 2 as const,
    heading: cleanText(item?.heading, "Outline heading", 180),
    purpose: cleanText(item?.purpose, "Outline purpose", 500),
  })) : existing.outline;

  return {
    ...existing,
    name: input.name === undefined ? existing.name : cleanText(input.name, "Brief name", 100),
    primaryKeyword: input.primaryKeyword === undefined ? existing.primaryKeyword : cleanText(input.primaryKeyword, "Primary keyword", 200),
    supportingKeywords: input.supportingKeywords === undefined ? existing.supportingKeywords : uniqueStrings(input.supportingKeywords, 100, 200),
    suggestedSlug: input.suggestedSlug === undefined ? existing.suggestedSlug : cleanText(input.suggestedSlug, "Suggested slug", 120),
    title: input.title === undefined ? existing.title : cleanText(input.title, "Title", 180),
    metaDescription: input.metaDescription === undefined ? existing.metaDescription : cleanText(input.metaDescription, "Meta description", 320),
    h1: input.h1 === undefined ? existing.h1 : cleanText(input.h1, "H1", 180),
    audience: input.audience === undefined ? existing.audience : cleanText(input.audience, "Audience", 500),
    searchIntentSummary: input.searchIntentSummary === undefined ? existing.searchIntentSummary : cleanText(input.searchIntentSummary, "Search intent summary", 700),
    angle: input.angle === undefined ? existing.angle : cleanText(input.angle, "Content angle", 700),
    outline,
    questions: input.questions === undefined ? existing.questions : uniqueStrings(input.questions, 30, 220),
    internalLinkIdeas: input.internalLinkIdeas === undefined ? existing.internalLinkIdeas : uniqueStrings(input.internalLinkIdeas, 30, 300),
    schemaTypes: input.schemaTypes === undefined ? existing.schemaTypes : uniqueStrings(input.schemaTypes, 12, 80),
    qualityChecklist: input.qualityChecklist === undefined ? existing.qualityChecklist : uniqueStrings(input.qualityChecklist, 30, 300),
    status,
    updatedAt: new Date().toISOString(),
  };
}

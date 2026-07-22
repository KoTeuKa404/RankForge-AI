export type Severity = "critical" | "high" | "medium" | "low";

export interface SeoIssue {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  url?: string;
  evidence?: string;
}

export interface PageAudit {
  url: string;
  status: number;
  contentType: string;
  loadTimeMs: number;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  lang: string;
  h1: string[];
  headingCount: number;
  wordCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: string[];
  externalLinks: string[];
  schemaCount: number;
  ogTitle: string;
  ogDescription: string;
  incomingLinks: number;
}

export interface PageChange {
  url: string;
  fields: Array<"status" | "title" | "description" | "canonical" | "robots" | "wordCount">;
}

export interface AuditComparison {
  previousAuditId: string;
  previousFinishedAt: string;
  scoreDelta: number;
  trend: "improved" | "declined" | "unchanged";
  newIssues: SeoIssue[];
  fixedIssues: SeoIssue[];
  persistentIssueCount: number;
  newPages: string[];
  removedPages: string[];
  changedPages: PageChange[];
}

export interface AuditResult {
  id: string;
  rootUrl: string;
  startedAt: string;
  finishedAt: string;
  score: number;
  pagesScanned: number;
  issues: SeoIssue[];
  pages: PageAudit[];
  robotsTxtFound: boolean;
  sitemapFound: boolean;
  stoppedReason?: string;
  comparison?: AuditComparison;
}

export interface Project {
  id: string;
  name: string;
  rootUrl: string;
  createdAt: string;
}

export interface AuditSummary {
  id: string;
  projectId: string | null;
  rootUrl: string;
  score: number;
  pagesScanned: number;
  issueCount: number;
  createdAt: string;
  previousAuditId: string | null;
  scoreDelta: number | null;
  newIssueCount: number;
  fixedIssueCount: number;
}

export interface UserIdentity {
  authenticated: boolean;
  email?: string;
  name?: string;
}

export type AiProviderName = "openai" | "gemini";

export interface AiFix {
  summary: string;
  whyItMatters: string;
  implementation: string;
  code?: string;
  verification: string[];
  provider?: AiProviderName;
}

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational" | "local";
export type KeywordPageType = "guide" | "comparison" | "landing" | "brand" | "local-landing";

export interface KeywordItem {
  id: string;
  keyword: string;
  normalized: string;
  intent: SearchIntent;
  pageType: KeywordPageType;
  clusterId: string;
  priority: number;
}

export interface KeywordCluster {
  id: string;
  name: string;
  primaryKeyword: string;
  intent: SearchIntent;
  pageType: KeywordPageType;
  suggestedSlug: string;
  confidence: number;
  keywords: string[];
}

export interface KeywordOverlapWarning {
  clusterA: string;
  clusterB: string;
  similarity: number;
  reason: string;
}

export interface KeywordAnalysis {
  id: string;
  projectId: string | null;
  name: string;
  createdAt: string;
  inputCount: number;
  uniqueCount: number;
  keywords: KeywordItem[];
  clusters: KeywordCluster[];
  overlapWarnings: KeywordOverlapWarning[];
}

export interface KeywordAnalysisSummary {
  id: string;
  projectId: string | null;
  name: string;
  inputCount: number;
  uniqueCount: number;
  clusterCount: number;
  createdAt: string;
}

export type ContentBriefStatus = "draft" | "review" | "approved";

export interface ContentOutlineSection {
  id: string;
  level: 2 | 3;
  heading: string;
  purpose: string;
}

export interface ContentBrief {
  id: string;
  projectId: string | null;
  sourceAnalysisId: string | null;
  sourceClusterId: string | null;
  name: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  intent: SearchIntent;
  pageType: KeywordPageType;
  suggestedSlug: string;
  title: string;
  metaDescription: string;
  h1: string;
  audience: string;
  searchIntentSummary: string;
  angle: string;
  outline: ContentOutlineSection[];
  questions: string[];
  internalLinkIdeas: string[];
  schemaTypes: string[];
  qualityChecklist: string[];
  status: ContentBriefStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBriefSummary {
  id: string;
  projectId: string | null;
  name: string;
  primaryKeyword: string;
  status: ContentBriefStatus;
  updatedAt: string;
}

export type InternalLinkSuggestionStatus = "proposed" | "accepted" | "dismissed";

export interface InternalLinkSuggestion {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  status: InternalLinkSuggestionStatus;
}

export interface InternalLinkAnalysis {
  id: string;
  projectId: string | null;
  auditId: string;
  rootUrl: string;
  createdAt: string;
  pageCount: number;
  orphanPages: string[];
  underlinkedPages: string[];
  suggestions: InternalLinkSuggestion[];
  skippedTargets: string[];
}

export interface InternalLinkAnalysisSummary {
  id: string;
  projectId: string | null;
  auditId: string;
  rootUrl: string;
  suggestionCount: number;
  orphanCount: number;
  createdAt: string;
}

export type MonitorCadence = "daily" | "weekly" | "monthly";
export type MonitorRunStatus = "idle" | "running" | "success" | "failed";
export type MonitoringAlertSeverity = "critical" | "warning" | "info";

export interface MonitoringConfig {
  id: string;
  projectId: string;
  name: string;
  rootUrl: string;
  maxPages: number;
  cadence: MonitorCadence;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastAuditId: string | null;
  lastStatus: MonitorRunStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitoringAlert {
  id: string;
  monitorId: string;
  auditId: string | null;
  severity: MonitoringAlertSeverity;
  kind: "score_drop" | "new_critical" | "new_high" | "crawl_problem" | "recovery";
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface MonitorRunResult {
  monitor: MonitoringConfig;
  audit: AuditResult | null;
  alerts: MonitoringAlert[];
}

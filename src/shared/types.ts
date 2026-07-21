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
}

export interface UserIdentity {
  authenticated: boolean;
  email?: string;
  name?: string;
}

export interface AiFix {
  summary: string;
  whyItMatters: string;
  implementation: string;
  code?: string;
  verification: string[];
}

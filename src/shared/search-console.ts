export interface SearchConsoleProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchConsoleConnectionStatus {
  configured: boolean;
  connected: boolean;
  projectId: string;
  siteUrl: string | null;
  tokenExpiresAt: number | null;
  updatedAt: string | null;
}

export interface SearchConsoleRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type SearchOpportunityKind =
  | "striking-distance"
  | "low-ctr"
  | "high-impressions"
  | "content-gap";

export interface SearchOpportunity {
  id: string;
  kind: SearchOpportunityKind;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  score: number;
  recommendation: string;
}

export interface SearchConsoleSnapshot {
  id: string;
  projectId: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  rows: SearchConsoleRow[];
  opportunities: SearchOpportunity[];
  createdAt: string;
}

export interface UsageSummary {
  period: string;
  auditJobs: number;
  aiFixes: number;
  gscSyncs: number;
  pagesCrawled: number;
  limits: {
    auditJobs: number;
    aiFixes: number;
    gscSyncs: number;
    pagesCrawled: number;
  };
}

import type {
  AiFix,
  AuditResult,
  AuditSummary,
  ContentBrief,
  ContentBriefSummary,
  KeywordAnalysis,
  KeywordAnalysisSummary,
  KeywordCluster,
  InternalLinkAnalysis,
  InternalLinkAnalysisSummary,
  MonitorCadence,
  MonitorRunResult,
  MonitoringAlert,
  MonitoringConfig,
  PageAudit,
  Project,
  SeoIssue,
  UserIdentity,
} from "../shared/types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
  return payload as T;
}

function compactAiPage(page: PageAudit): PageAudit {
  return {
    ...page,
    title: page.title.slice(0, 300),
    description: page.description.slice(0, 600),
    canonical: page.canonical.slice(0, 1_000),
    robots: page.robots.slice(0, 300),
    h1: page.h1.slice(0, 5).map((value) => value.slice(0, 300)),
    internalLinks: [],
    externalLinks: [],
  };
}

export const api = {
  me: () => request<UserIdentity>("/api/me"),
  projects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (name: string, rootUrl: string) => request<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, rootUrl }),
  }),
  audits: (projectId?: string) => request<{ audits: AuditSummary[] }>(`/api/audits${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  audit: (url: string, maxPages: number, projectId?: string) => request<{ audit: AuditResult }>("/api/audits", {
    method: "POST",
    body: JSON.stringify({ url, maxPages, projectId: projectId || undefined }),
  }),
  auditById: (id: string) => request<{ audit: AuditResult }>(`/api/audits/${encodeURIComponent(id)}`),
  aiFix: (issue: SeoIssue, pages: PageAudit[] = []) => request<{ fix: AiFix }>("/api/ai-fix", {
    method: "POST",
    // `page` remains backward-compatible with the existing endpoint; the server accepts one page or an array.
    body: JSON.stringify({ issue, page: pages.slice(0, 12).map(compactAiPage) }),
  }),
  keywordAnalyses: (projectId?: string) => request<{ analyses: KeywordAnalysisSummary[] }>(`/api/keyword-analyses${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  analyzeKeywords: (input: string, projectId?: string, name?: string) => request<{ analysis: KeywordAnalysis }>("/api/keyword-analyses", {
    method: "POST",
    body: JSON.stringify({ input, projectId: projectId || undefined, name }),
  }),
  keywordAnalysisById: (id: string) => request<{ analysis: KeywordAnalysis }>(`/api/keyword-analyses/${encodeURIComponent(id)}`),
  contentBriefs: (projectId?: string) => request<{ briefs: ContentBriefSummary[] }>(`/api/content-briefs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  createContentBrief: (cluster: KeywordCluster, projectId?: string, sourceAnalysisId?: string) => request<{ brief: ContentBrief }>("/api/content-briefs", {
    method: "POST",
    body: JSON.stringify({ cluster, projectId: projectId || undefined, sourceAnalysisId: sourceAnalysisId || undefined }),
  }),
  contentBriefById: (id: string) => request<{ brief: ContentBrief }>(`/api/content-briefs/${encodeURIComponent(id)}`),
  updateContentBrief: (id: string, brief: ContentBrief) => request<{ brief: ContentBrief }>(`/api/content-briefs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ brief }),
  }),
  internalLinkAnalyses: (projectId?: string) => request<{ analyses: InternalLinkAnalysisSummary[] }>(`/api/internal-link-analyses${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  analyzeInternalLinks: (auditId: string, projectId?: string) => request<{ analysis: InternalLinkAnalysis }>("/api/internal-link-analyses", {
    method: "POST",
    body: JSON.stringify({ auditId, projectId: projectId || undefined }),
  }),
  internalLinkAnalysisById: (id: string) => request<{ analysis: InternalLinkAnalysis }>(`/api/internal-link-analyses/${encodeURIComponent(id)}`),
  monitors: () => request<{ monitors: MonitoringConfig[] }>("/api/monitors"),
  createMonitor: (input: { projectId: string; name: string; rootUrl: string; maxPages: number; cadence: MonitorCadence }) => request<{ monitor: MonitoringConfig }>("/api/monitors", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  updateMonitor: (id: string, enabled: boolean) => request<{ monitor: MonitoringConfig }>(`/api/monitors/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }),
  runMonitor: (id: string) => request<MonitorRunResult>(`/api/monitors/${encodeURIComponent(id)}/run`, { method: "POST" }),
  monitoringAlerts: () => request<{ alerts: MonitoringAlert[] }>("/api/monitoring-alerts"),
  readMonitoringAlert: (id: string) => request<{ ok: true }>(`/api/monitoring-alerts/${encodeURIComponent(id)}/read`, { method: "POST" }),
};

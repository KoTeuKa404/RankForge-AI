import type {
  AiFix,
  AuditJob,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAuditJob(
  initial: AuditJob,
  onProgress?: (job: AuditJob) => void,
): Promise<AuditResult> {
  let job = initial;
  const deadline = Date.now() + 180_000;
  onProgress?.(job);

  while (job.status === "queued" || job.status === "running") {
    if (Date.now() > deadline) throw new Error("The audit is still running. Keep the job ID and check it again shortly.");
    await sleep(600);
    const response = await request<{ job: AuditJob }>(`/api/audit-jobs/${encodeURIComponent(job.id)}`);
    job = response.job;
    onProgress?.(job);
  }

  if (job.status === "failed") throw new Error(job.error || "The audit job failed.");
  if (!job.audit) throw new Error("The completed audit job did not contain a result.");
  return job.audit;
}

export const api = {
  me: () => request<UserIdentity>("/api/me"),
  projects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (name: string, rootUrl: string) => request<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, rootUrl }),
  }),
  audits: (projectId?: string) => request<{ audits: AuditSummary[] }>(`/api/audits${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  startAuditJob: (url: string, maxPages: number, projectId?: string) => request<{ job: AuditJob }>("/api/audit-jobs", {
    method: "POST",
    body: JSON.stringify({ url, maxPages, projectId: projectId || undefined }),
  }),
  auditJob: (id: string) => request<{ job: AuditJob }>(`/api/audit-jobs/${encodeURIComponent(id)}`),
  retryAuditJob: (id: string) => request<{ job: AuditJob }>(`/api/audit-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  waitAuditJob: async (job: AuditJob, onProgress?: (value: AuditJob) => void) => ({ audit: await waitForAuditJob(job, onProgress) }),
  audit: async (url: string, maxPages: number, projectId?: string, onProgress?: (job: AuditJob) => void) => {
    const started = await request<{ job: AuditJob }>("/api/audit-jobs", {
      method: "POST",
      body: JSON.stringify({ url, maxPages, projectId: projectId || undefined }),
    });
    return { audit: await waitForAuditJob(started.job, onProgress) };
  },
  auditById: (id: string) => request<{ audit: AuditResult }>(`/api/audits/${encodeURIComponent(id)}`),
  aiFix: (issue: SeoIssue, pages: PageAudit[] = []) => request<{ fix: AiFix }>("/api/ai-fix", {
    method: "POST",
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

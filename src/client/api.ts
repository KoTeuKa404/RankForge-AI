import type { AiFix, AuditResult, AuditSummary, PageAudit, Project, SeoIssue, UserIdentity } from "../shared/types";

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
  aiFix: (issue: SeoIssue, page?: PageAudit) => request<{ fix: AiFix }>("/api/ai-fix", {
    method: "POST",
    body: JSON.stringify({ issue, page }),
  }),
};

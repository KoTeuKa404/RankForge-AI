import type { AuditComparison, AuditResult, PageAudit, PageChange, SeoIssue } from "../shared/types";

function normalizeIssueUrl(raw?: string): string {
  if (!raw) return "site-wide";
  try {
    const url = new URL(raw);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function issueFingerprint(issue: SeoIssue): string {
  return `${issue.code}|${normalizeIssueUrl(issue.url)}`;
}

function pageMap(pages: PageAudit[]): Map<string, PageAudit> {
  return new Map(pages.map((page) => [normalizeIssueUrl(page.url), page]));
}

function changedFields(current: PageAudit, previous: PageAudit): PageChange["fields"] {
  const fields: PageChange["fields"] = [];
  if (current.status !== previous.status) fields.push("status");
  if (current.title !== previous.title) fields.push("title");
  if (current.description !== previous.description) fields.push("description");
  if (current.canonical !== previous.canonical) fields.push("canonical");
  if (current.robots !== previous.robots) fields.push("robots");
  if (current.wordCount !== previous.wordCount) fields.push("wordCount");
  return fields;
}

export function compareAudits(current: AuditResult, previous: AuditResult): AuditComparison {
  const currentIssues = new Map(current.issues.map((issue) => [issueFingerprint(issue), issue]));
  const previousIssues = new Map(previous.issues.map((issue) => [issueFingerprint(issue), issue]));

  const newIssues = [...currentIssues.entries()]
    .filter(([fingerprint]) => !previousIssues.has(fingerprint))
    .map(([, issue]) => issue);
  const fixedIssues = [...previousIssues.entries()]
    .filter(([fingerprint]) => !currentIssues.has(fingerprint))
    .map(([, issue]) => issue);
  const persistentIssueCount = [...currentIssues.keys()].filter((fingerprint) => previousIssues.has(fingerprint)).length;

  const currentPages = pageMap(current.pages);
  const previousPages = pageMap(previous.pages);
  const newPages = [...currentPages.keys()].filter((url) => !previousPages.has(url));
  const removedPages = [...previousPages.keys()].filter((url) => !currentPages.has(url));
  const changedPages: PageChange[] = [];

  for (const [url, page] of currentPages) {
    const before = previousPages.get(url);
    if (!before) continue;
    const fields = changedFields(page, before);
    if (fields.length > 0) changedPages.push({ url: page.url, fields });
  }

  const scoreDelta = current.score - previous.score;
  return {
    previousAuditId: previous.id,
    previousFinishedAt: previous.finishedAt,
    scoreDelta,
    trend: scoreDelta > 0 ? "improved" : scoreDelta < 0 ? "declined" : "unchanged",
    newIssues,
    fixedIssues,
    persistentIssueCount,
    newPages,
    removedPages,
    changedPages,
  };
}

import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { auditIssuesCsv, issueKey } from "./export";
import KeywordWorkspace from "./KeywordWorkspace";
import ContentBriefWorkspace, { type BriefSeed } from "./ContentBriefWorkspace";
import InternalLinkWorkspace from "./InternalLinkWorkspace";
import MonitoringWorkspace from "./MonitoringWorkspace";
import type { AiFix, AuditJob, AuditResult, AuditSummary, PageAudit, Project, SeoIssue, Severity, UserIdentity } from "../shared/types";

type Filter = "all" | Severity;

const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const severityLabel: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function htmlReport(audit: AuditResult): string {
  const rows = audit.issues.map((issue) => `<tr><td>${escapeHtml(severityLabel[issue.severity])}</td><td>${escapeHtml(issue.title)}</td><td>${escapeHtml(issue.url || "Site-wide")}</td><td>${escapeHtml(issue.recommendation)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RankForge audit — ${escapeHtml(audit.rootUrl)}</title><style>body{font-family:system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#18202f}h1{margin-bottom:4px}.score{font-size:52px;font-weight:800}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{padding:10px;border:1px solid #d8deea;text-align:left;vertical-align:top}th{background:#f4f6fa}</style><h1>Technical SEO audit</h1><p>${escapeHtml(audit.rootUrl)}</p><div class="score">${audit.score}/100</div><p>${audit.pagesScanned} pages · ${audit.issues.length} issues · ${escapeHtml(new Date(audit.finishedAt).toLocaleString())}</p><table><thead><tr><th>Severity</th><th>Issue</th><th>URL</th><th>Recommendation</th></tr></thead><tbody>${rows}</tbody></table></html>`;
}

function ScoreRing({ score }: { score: number }) {
  return <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><span>{score}</span><small>/100</small></div>;
}

function cleanEvidenceUrl(raw: string): string {
  return raw.replace(/[),.;]+$/, "");
}

function affectedPagesForIssue(issue: SeoIssue, audit: AuditResult | null): PageAudit[] {
  if (!audit) return [];
  const urls = new Set<string>();
  if (issue.url) urls.add(issue.url);
  for (const match of issue.evidence?.match(/https?:\/\/[^\s<>"']+/g) || []) urls.add(cleanEvidenceUrl(match));
  const matched = audit.pages.filter((page) => urls.has(page.url));
  if (matched.length > 0) return matched.slice(0, 12);
  const fallback = issue.url ? audit.pages.find((page) => page.url === issue.url) : undefined;
  return fallback ? [fallback] : [];
}

function App() {
  const [identity, setIdentity] = useState<UserIdentity>({ authenticated: false });
  const [projects, setProjects] = useState<Project[]>([]);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [url, setUrl] = useState("https://example.com");
  const [maxPages, setMaxPages] = useState(10);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditJob, setAuditJob] = useState<AuditJob | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<SeoIssue | null>(null);
  const [aiFix, setAiFix] = useState<AiFix | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [workspace, setWorkspace] = useState<"audit" | "keywords" | "links" | "briefs" | "monitoring">("audit");
  const [briefSeed, setBriefSeed] = useState<BriefSeed | null>(null);

  useEffect(() => {
    api.me().then((me) => {
      setIdentity(me);
      if (me.authenticated) {
        Promise.all([api.projects(), api.audits()]).then(([projectData, auditData]) => {
          setProjects(projectData.projects);
          setHistory(auditData.audits);
        }).catch((error: Error) => setMessage(error.message));
      }
    }).catch(() => setIdentity({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!identity.authenticated) return;
    api.audits(selectedProject || undefined).then((data) => setHistory(data.audits)).catch(() => undefined);
  }, [selectedProject, identity.authenticated]);

  const issueCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    audit?.issues.forEach((issue) => { counts[issue.severity] += 1; });
    return counts;
  }, [audit]);

  const newIssueKeys = useMemo(() => new Set((audit?.comparison?.newIssues || []).map(issueKey)), [audit]);

  const visibleIssues = useMemo(() => (audit?.issues || [])
    .filter((issue) => filter === "all" || issue.severity === filter)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]), [audit, filter]);

  async function runAudit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setAudit(null);
    setAuditJob(null);
    setSelectedIssue(null);
    try {
      const result = await api.audit(url, maxPages, selectedProject || undefined, setAuditJob);
      setAudit(result.audit);
      setUrl(result.audit.rootUrl);
      if (identity.authenticated) {
        const data = await api.audits(selectedProject || undefined);
        setHistory(data.audits);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    setMessage("");
    try {
      const result = await api.createProject(projectName, url);
      setProjects((current) => [result.project, ...current]);
      setSelectedProject(result.project.id);
      setProjectName("");
      setNewProjectOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create project.");
    }
  }

  async function openHistory(item: AuditSummary) {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.auditById(item.id);
      setAudit(result.audit);
      setUrl(result.audit.rootUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load audit.");
    } finally {
      setLoading(false);
    }
  }

  async function generateFix(issue: SeoIssue) {
    setSelectedIssue(issue);
    setAiFix(null);
    setAiLoading(true);
    const pages = affectedPagesForIssue(issue, audit);
    try {
      const result = await api.aiFix(issue, pages);
      setAiFix(result.fix);
    } catch (error) {
      setAiFix({
        summary: "AI Fix is unavailable",
        whyItMatters: error instanceof Error ? error.message : "The request failed.",
        implementation: "Configure OPENAI_API_KEY or GEMINI_API_KEY in hosted secrets, confirm /api/health reports ai: true, and retry.",
        verification: ["Check /api/health reports ai: true", "Retry this issue"],
      });
    } finally {
      setAiLoading(false);
    }
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="RankForge home"><span className="brand-mark">R</span><span>RankForge <b>AI</b></span></a>
      <nav><a href="#audit" onClick={() => setWorkspace("audit")}>Audit</a><a href="#audit" onClick={() => setWorkspace("keywords")}>Keywords</a><a href="#audit" onClick={() => setWorkspace("links")}>Links</a><a href="#audit" onClick={() => setWorkspace("briefs")}>Briefs</a><a href="#audit" onClick={() => setWorkspace("monitoring")}>Monitoring</a><a href="#history" onClick={() => setWorkspace("audit")}>History</a></nav>
      {identity.authenticated
        ? <div className="identity"><span>{identity.name || identity.email}</span><a href="/signout-with-chatgpt">Sign out</a></div>
        : <a className="button ghost" href="/signin-with-chatgpt">Sign in with ChatGPT</a>}
    </header>

    <main id="top">
      <section className="hero">
        <div className="eyebrow">Technical SEO command center</div>
        <h1>Find what blocks growth.<br/><span>Ship the fix.</span></h1>
        <p>Run a security-bounded crawl, prioritize technical issues, and turn findings into implementation-ready AI recommendations.</p>
        <div className="trust-row"><span>✓ Async crawl jobs</span><span>✓ Up to 25 pages</span><span>✓ D1 history</span><span>✓ R2 reports</span></div>
      </section>

      <section className="workspace" id="audit">
        <aside className="sidebar">
          <div className="sidebar-title">Workspace</div>
          <button className={`nav-item ${workspace === "audit" ? "active" : ""}`} onClick={() => setWorkspace("audit")}><span>⌁</span> Site audit</button>
          <button className={`nav-item ${workspace === "keywords" ? "active" : ""}`} onClick={() => setWorkspace("keywords")}><span>◎</span> Keywords</button>
          <button className={`nav-item ${workspace === "links" ? "active" : ""}`} onClick={() => setWorkspace("links")}><span>↗</span> Internal links</button>
          <button className={`nav-item ${workspace === "briefs" ? "active" : ""}`} onClick={() => setWorkspace("briefs")}><span>✦</span> Content briefs</button><button className={`nav-item ${workspace === "monitoring" ? "active" : ""}`} onClick={() => setWorkspace("monitoring")}><span>◉</span> Monitoring</button>
          <div className="sidebar-title space-top">Project</div>
          {identity.authenticated ? <>
            <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} aria-label="Selected project">
              <option value="">Unsaved audit</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <button className="button subtle full" onClick={() => setNewProjectOpen(true)}>+ New project</button>
          </> : <div className="signin-note">Sign in to save projects and compare audit history.</div>}
        </aside>

        {workspace === "audit" ? <div className="content-panel">
          <div className="panel-heading">
            <div><div className="eyebrow">Crawler</div><h2>Technical site audit</h2></div>
            <div className="live-pill"><span/> Runtime ready</div>
          </div>
          <form className="audit-form" onSubmit={runAudit}>
            <label><span>Website URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" inputMode="url" autoComplete="url" /></label>
            <label className="page-limit"><span>Page limit</span><select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}><option value={5}>5 pages</option><option value={10}>10 pages</option><option value={25}>25 pages</option></select></label>
            <button className="button primary run" disabled={loading}>{loading ? <><i className="spinner"/> {auditJob?.status === "queued" ? "Queued…" : "Crawling…"}</> : <>Run audit <span>→</span></>}</button>
          </form>
          {message && <div className="alert">{message}</div>}

          {!audit && !loading && <div className="empty-state"><div className="scan-graphic"><span/><span/><span/></div><h3>Ready to inspect a website</h3><p>The crawler checks metadata, headings, canonicals, indexability, links, content depth, response status, Open Graph, schema, robots.txt, and sitemap.xml.</p></div>}

          {loading && <div className="loading-state"><div className="scanner"><span/></div><h3>{auditJob?.status === "queued" ? "Audit queued" : "Crawling and evaluating pages"}</h3><p>{auditJob ? `${auditJob.pagesScanned}/${auditJob.maxPages} pages · attempt ${Math.max(1, auditJob.attempts)}` : "Creating an asynchronous audit job…"}</p><div className="job-progress" aria-label={`Audit progress ${auditJob?.progress || 0}%`}><span style={{ width: `${auditJob?.progress || 2}%` }}/></div><small>{auditJob?.progress || 0}% · You can keep this page open while the Worker completes the job.</small></div>}

          {audit && <>
            <section className="result-summary">
              <ScoreRing score={audit.score}/>
              <div className="summary-copy"><div className="eyebrow">Audit complete</div><h3>{audit.rootUrl}</h3><p>{audit.pagesScanned} pages scanned · {audit.issues.length} findings{audit.stoppedReason ? ` · ${audit.stoppedReason}` : ""}</p></div>
              <div className="summary-actions"><button className="button subtle" onClick={() => download("rankforge-audit.csv", auditIssuesCsv(audit), "text/csv;charset=utf-8")}>Export CSV</button><button className="button subtle" onClick={() => download("rankforge-audit.json", JSON.stringify(audit, null, 2), "application/json")}>Export JSON</button><button className="button subtle" onClick={() => download("rankforge-audit.html", htmlReport(audit), "text/html")}>Export report</button>{auditJob?.reportKey && <a className="button subtle" href={`/api/audit-jobs/${auditJob.id}/report`}>Stored R2 JSON</a>}</div>
            </section>

            {audit.comparison && <section className={`comparison-card ${audit.comparison.trend}`}>
              <div><div className="eyebrow">Since previous audit</div><h3>{audit.comparison.trend === "improved" ? "SEO health improved" : audit.comparison.trend === "declined" ? "New regressions detected" : "Score is unchanged"}</h3><p>Compared with {new Date(audit.comparison.previousFinishedAt).toLocaleString()}.</p></div>
              <div className="comparison-stats"><span><b>{audit.comparison.scoreDelta > 0 ? "+" : ""}{audit.comparison.scoreDelta}</b><small>score</small></span><span><b>{audit.comparison.newIssues.length}</b><small>new issues</small></span><span><b>{audit.comparison.fixedIssues.length}</b><small>fixed</small></span><span><b>{audit.comparison.changedPages.length}</b><small>changed pages</small></span></div>
            </section>}

            <section className="metric-grid">
              {(["critical", "high", "medium", "low"] as Severity[]).map((severity) => <button key={severity} className={`metric ${severity}`} onClick={() => setFilter(severity)}><span>{severityLabel[severity]}</span><strong>{issueCounts[severity]}</strong><small>findings</small></button>)}
              <div className="metric neutral"><span>Coverage</span><strong>{audit.pagesScanned}</strong><small>HTML pages</small></div>
            </section>

            <section id="issues" className="issues-section">
              <div className="section-bar"><div><div className="eyebrow">Prioritized backlog</div><h3>Issues</h3></div><div className="filters">{(["all", "critical", "high", "medium", "low"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? `All ${audit.issues.length}` : severityLabel[item]}</button>)}</div></div>
              <div className="issue-list">
                {visibleIssues.length === 0 && <div className="empty-row">No issues in this severity group.</div>}
                {visibleIssues.map((issue) => <article className="issue" key={issue.id}>
                  <div className={`severity-dot ${issue.severity}`} title={severityLabel[issue.severity]}/>
                  <div className="issue-copy"><div className="issue-title"><h4>{issue.title}</h4>{newIssueKeys.has(issueKey(issue)) && <span className="badge new">New</span>}<span className={`badge ${issue.severity}`}>{severityLabel[issue.severity]}</span></div><p>{issue.description}</p>{issue.url && <a href={issue.url} target="_blank" rel="noreferrer">{issue.url}</a>}<div className="recommendation"><b>Recommended:</b> {issue.recommendation}</div>{issue.evidence && <details><summary>Evidence</summary><pre>{issue.evidence}</pre></details>}</div>
                  <button className="button ai" onClick={() => generateFix(issue)}>✦ AI Fix</button>
                </article>)}
              </div>
            </section>

            <section className="pages-section"><div className="section-bar"><div><div className="eyebrow">Crawl inventory</div><h3>Pages</h3></div></div><div className="table-wrap"><table><thead><tr><th>URL</th><th>Status</th><th>Title</th><th>Words</th><th>H1</th><th>Time</th></tr></thead><tbody>{audit.pages.map((page) => <tr key={page.url}><td><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a></td><td><span className={`status-code ${page.status >= 400 ? "bad" : "good"}`}>{page.status}</span></td><td>{page.title || <em>Missing</em>}</td><td>{page.wordCount}</td><td>{page.h1.length}</td><td>{page.loadTimeMs} ms</td></tr>)}</tbody></table></div></section>
          </>}
        </div> : workspace === "keywords" ? <KeywordWorkspace authenticated={identity.authenticated} selectedProject={selectedProject} projects={projects} onSelectProject={setSelectedProject} onCreateBrief={(analysisId, cluster) => { setBriefSeed({ analysisId, cluster }); setWorkspace("briefs"); }}/> : workspace === "links" ? <InternalLinkWorkspace authenticated={identity.authenticated} selectedProject={selectedProject} projects={projects} onSelectProject={setSelectedProject}/> : workspace === "briefs" ? <ContentBriefWorkspace authenticated={identity.authenticated} selectedProject={selectedProject} projects={projects} onSelectProject={setSelectedProject} seed={briefSeed} onSeedConsumed={() => setBriefSeed(null)}/> : <MonitoringWorkspace authenticated={identity.authenticated} projects={projects}/>} 
      </section>

      {workspace === "audit" && <section id="history" className="history-section">
        <div><div className="eyebrow">Durable records</div><h2>Recent audits</h2><p>Signed-in users can reopen previous results and compare progress.</p></div>
        <div className="history-list">{!identity.authenticated ? <div className="history-empty">Sign in with ChatGPT to enable saved audit history.</div> : history.length === 0 ? <div className="history-empty">No saved audits yet. Select a project and run your first crawl.</div> : history.slice(0, 8).map((item) => <button key={item.id} onClick={() => openHistory(item)}><span><b>{item.rootUrl}</b><small>{new Date(item.createdAt).toLocaleString()}</small>{item.previousAuditId && <small className="history-delta">{item.scoreDelta && item.scoreDelta > 0 ? "+" : ""}{item.scoreDelta ?? 0} score · {item.newIssueCount} new · {item.fixedIssueCount} fixed</small>}</span><strong>{item.score}<small>/100</small></strong></button>)}</div>
      </section>}
    </main>

    <footer><span>RankForge AI v0.7 beta</span><span>Built for transparent, standards-compliant SEO operations.</span></footer>

    {selectedIssue && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedIssue(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="ai-fix-title"><button className="modal-close" onClick={() => setSelectedIssue(null)} aria-label="Close">×</button><div className="eyebrow">AI remediation</div><h2 id="ai-fix-title">{selectedIssue.title}</h2>{aiLoading ? <div className="ai-loading"><i className="spinner"/> Generating an implementation-ready fix…</div> : aiFix && <div className="fix-content">{aiFix.provider && <div className="provider-pill">Generated by {aiFix.provider === "gemini" ? "Gemini" : "OpenAI"}</div>}<h4>Summary</h4><p>{aiFix.summary}</p><h4>Why it matters</h4><p>{aiFix.whyItMatters}</p><h4>Implementation</h4><p>{aiFix.implementation}</p>{aiFix.code && <><h4>Suggested code</h4><pre>{aiFix.code}</pre></>}<h4>Verify</h4><ol>{aiFix.verification.map((step, index) => <li key={index}>{step}</li>)}</ol></div>}</section></div>}

    {newProjectOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setNewProjectOpen(false); }}><section className="modal small" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setNewProjectOpen(false)}>×</button><div className="eyebrow">Workspace</div><h2>Create project</h2><label className="modal-field"><span>Name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="My SEO project" maxLength={80}/></label><label className="modal-field"><span>Root URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url"/></label><button className="button primary full" onClick={createProject}>Create project</button></section></div>}
  </div>;
}

export default App;

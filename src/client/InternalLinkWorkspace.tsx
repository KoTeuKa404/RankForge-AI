import { useEffect, useState } from "react";
import { api } from "./api";
import { internalLinksCsv } from "./internal-link-export";
import type { AuditSummary, InternalLinkAnalysis, InternalLinkAnalysisSummary, Project } from "../shared/types";

interface Props {
  authenticated: boolean;
  selectedProject: string;
  projects: Project[];
  onSelectProject: (id: string) => void;
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

export default function InternalLinkWorkspace({ authenticated, selectedProject, projects, onSelectProject }: Props) {
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [selectedAudit, setSelectedAudit] = useState("");
  const [history, setHistory] = useState<InternalLinkAnalysisSummary[]>([]);
  const [analysis, setAnalysis] = useState<InternalLinkAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([api.audits(selectedProject || undefined), api.internalLinkAnalyses(selectedProject || undefined)])
      .then(([auditData, analysisData]) => {
        setAudits(auditData.audits);
        setHistory(analysisData.analyses);
        setSelectedAudit((current) => current && auditData.audits.some((item) => item.id === current) ? current : auditData.audits[0]?.id || "");
      })
      .catch((error: Error) => setMessage(error.message));
  }, [authenticated, selectedProject]);

  async function run() {
    if (!selectedAudit) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await api.analyzeInternalLinks(selectedAudit, selectedProject || undefined);
      setAnalysis(result.analysis);
      const data = await api.internalLinkAnalyses(selectedProject || undefined);
      setHistory(data.analyses);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Internal link analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function open(id: string) {
    setLoading(true);
    try {
      const result = await api.internalLinkAnalysisById(id);
      setAnalysis(result.analysis);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load internal link analysis.");
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) return <div className="content-panel"><div className="empty-state"><h3>Sign in to use the Internal Linking Agent</h3><p>The agent reads a saved crawl, so ownership is verified server-side before pages are analyzed.</p></div></div>;

  return <div className="content-panel link-workspace">
    <div className="panel-heading"><div><div className="eyebrow">Internal linking agent</div><h2>Find contextual paths to underlinked pages</h2></div><div className="live-pill"><span/> Crawl + semantic</div></div>
    <div className="link-layout">
      <section className="link-control-card">
        <label><span>Project</span><select value={selectedProject} onChange={(event) => onSelectProject(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span>Saved audit</span><select value={selectedAudit} onChange={(event) => setSelectedAudit(event.target.value)}><option value="">Select an audit</option>{audits.map((audit) => <option key={audit.id} value={audit.id}>{audit.rootUrl} · {audit.score}/100 · {new Date(audit.createdAt).toLocaleString()}</option>)}</select></label>
        <button className="button primary" onClick={run} disabled={loading || !selectedAudit}>{loading ? <><i className="spinner"/> Analyzing…</> : <>Build link plan <span>→</span></>}</button>
        <p>Only missing links between indexable pages are considered. Gemini embeddings improve relevance when configured; otherwise the deterministic crawler model remains active.</p>
      </section>
      <aside className="link-history-card"><div className="eyebrow">Saved plans</div>{history.length === 0 ? <p>No link analyses yet.</p> : history.slice(0, 10).map((item) => <button key={item.id} onClick={() => open(item.id)}><span><b>{item.rootUrl}</b><small>{new Date(item.createdAt).toLocaleString()}</small></span><strong>{item.suggestionCount}<small> links</small></strong></button>)}</aside>
    </div>
    {message && <div className="alert">{message}</div>}
    {analysis && <>
      <section className="link-summary"><div><div className="eyebrow">Link plan ready</div><h3>{analysis.rootUrl}</h3><p>{analysis.pageCount} indexable pages evaluated · {analysis.semanticEnhanced ? `semantic model ${analysis.semanticModel}` : "deterministic relevance fallback"}</p></div><button className="button subtle" onClick={() => download("rankforge-internal-links.csv", internalLinksCsv(analysis), "text/csv;charset=utf-8")}>Export CSV</button></section>
      <section className="metric-grid link-metrics"><div className="metric neutral"><span>Suggestions</span><strong>{analysis.suggestions.length}</strong><small>contextual links</small></div><div className="metric critical"><span>Orphan pages</span><strong>{analysis.orphanPages.length}</strong><small>zero incoming links</small></div><div className="metric medium"><span>Underlinked</span><strong>{analysis.underlinkedPages.length}</strong><small>one or fewer</small></div><div className="metric low"><span>No safe match</span><strong>{analysis.skippedTargets.length}</strong><small>review manually</small></div></section>
      {analysis.orphanPages.length > 0 && <section className="orphan-card"><div className="eyebrow">Orphan pages</div>{analysis.orphanPages.map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}>{url}</a>)}</section>}
      <section className="pages-section"><div className="section-bar"><div><div className="eyebrow">Recommended placements</div><h3>Source → target links</h3></div></div><div className="table-wrap"><table><thead><tr><th>Score</th><th>Source</th><th>Target</th><th>Anchor</th><th>Reason</th></tr></thead><tbody>{analysis.suggestions.map((item) => <tr key={item.id}><td><span className={`link-confidence ${item.confidence}`}>{item.score}</span></td><td><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a></td><td><a href={item.targetUrl} target="_blank" rel="noreferrer">{item.targetUrl}</a></td><td><b>{item.anchorText}</b></td><td>{item.reasons.join(" ")}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

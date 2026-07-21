import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { keywordAnalysisCsv } from "./keyword-export";
import type { KeywordAnalysis, KeywordAnalysisSummary, KeywordCluster, Project, SearchIntent } from "../shared/types";

const SAMPLE = `technical seo audit
website seo audit tool
best technical seo tools
seo audit service price
how to audit a website
technical seo checklist
website crawler for seo
seo site checker`;

const intentLabel: Record<SearchIntent, string> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
  local: "Local",
};

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

interface Props {
  authenticated: boolean;
  selectedProject: string;
  projects: Project[];
  onSelectProject: (id: string) => void;
  onCreateBrief: (analysisId: string | null, cluster: KeywordCluster) => void;
}

export default function KeywordWorkspace({ authenticated, selectedProject, projects, onSelectProject, onCreateBrief }: Props) {
  const [input, setInput] = useState(SAMPLE);
  const [name, setName] = useState("SEO topic map");
  const [analysis, setAnalysis] = useState<KeywordAnalysis | null>(null);
  const [history, setHistory] = useState<KeywordAnalysisSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    api.keywordAnalyses(selectedProject || undefined)
      .then((data) => setHistory(data.analyses))
      .catch(() => setHistory([]));
  }, [authenticated, selectedProject]);

  const intentCounts = useMemo(() => {
    const counts: Record<SearchIntent, number> = { informational: 0, commercial: 0, transactional: 0, navigational: 0, local: 0 };
    analysis?.keywords.forEach((keyword) => { counts[keyword.intent] += 1; });
    return counts;
  }, [analysis]);

  async function runAnalysis() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.analyzeKeywords(input, selectedProject || undefined, name);
      setAnalysis(result.analysis);
      if (authenticated) {
        const data = await api.keywordAnalyses(selectedProject || undefined);
        setHistory(data.analyses);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Keyword analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function openAnalysis(id: string) {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.keywordAnalysisById(id);
      setAnalysis(result.analysis);
      setName(result.analysis.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load keyword analysis.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="content-panel keyword-workspace">
    <div className="panel-heading">
      <div><div className="eyebrow">Keyword intelligence</div><h2>Turn raw queries into a content map</h2></div>
      <div className="live-pill"><span/> Deterministic analysis</div>
    </div>

    <div className="keyword-grid">
      <section className="keyword-input-card">
        <label><span>Analysis name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80}/></label>
        <label><span>Keywords or CSV</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={13} spellCheck={false}/></label>
        <div className="keyword-actions">
          <label><span>Project</span><select value={selectedProject} onChange={(event) => onSelectProject(event.target.value)}><option value="">Unsaved workspace</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <button className="button primary" onClick={runAnalysis} disabled={loading}>{loading ? <><i className="spinner"/> Analyzing…</> : <>Analyze keywords <span>→</span></>}</button>
        </div>
        <p className="input-help">Paste one keyword per line or CSV where the first column contains the query. Duplicates are removed automatically.</p>
      </section>

      <aside className="keyword-history-card">
        <div className="eyebrow">Saved analyses</div>
        {!authenticated ? <p>Sign in with ChatGPT to save analyses.</p> : history.length === 0 ? <p>No saved keyword analyses yet.</p> : history.slice(0, 8).map((item) => <button key={item.id} onClick={() => openAnalysis(item.id)}><span><b>{item.name}</b><small>{new Date(item.createdAt).toLocaleString()}</small></span><strong>{item.clusterCount}<small> clusters</small></strong></button>)}
      </aside>
    </div>

    {message && <div className="alert">{message}</div>}

    {analysis && <>
      <section className="keyword-summary">
        <div><div className="eyebrow">Analysis complete</div><h3>{analysis.name}</h3><p>{analysis.inputCount} imported · {analysis.uniqueCount} unique · {analysis.clusters.length} clusters</p></div>
        <button className="button subtle" onClick={() => download("rankforge-keywords.csv", keywordAnalysisCsv(analysis), "text/csv;charset=utf-8")}>Export CSV</button>
      </section>

      <section className="intent-grid">
        {(Object.keys(intentCounts) as SearchIntent[]).map((intent) => <div className={`intent-card ${intent}`} key={intent}><span>{intentLabel[intent]}</span><strong>{intentCounts[intent]}</strong></div>)}
      </section>

      {analysis.overlapWarnings.length > 0 && <section className="overlap-card"><div className="eyebrow">Cannibalization review</div><h3>{analysis.overlapWarnings.length} cluster overlaps need review</h3>{analysis.overlapWarnings.map((warning, index) => <p key={index}><b>{warning.clusterA}</b> ↔ <b>{warning.clusterB}</b> · {warning.similarity}% — {warning.reason}</p>)}</section>}

      <section className="cluster-section">
        <div className="section-bar"><div><div className="eyebrow">Topic architecture</div><h3>Clusters</h3></div></div>
        <div className="cluster-grid">{analysis.clusters.map((cluster) => <article className="cluster-card" key={cluster.id}>
          <div className="cluster-head"><div><span className={`intent-pill ${cluster.intent}`}>{intentLabel[cluster.intent]}</span><h4>{cluster.name}</h4></div><strong>{cluster.keywords.length}<small> keywords</small></strong></div>
          <dl><div><dt>Primary keyword</dt><dd>{cluster.primaryKeyword}</dd></div><div><dt>Page type</dt><dd>{cluster.pageType}</dd></div><div><dt>Suggested URL</dt><dd><code>{cluster.suggestedSlug}</code></dd></div><div><dt>Confidence</dt><dd>{cluster.confidence}%</dd></div></dl>
          <div className="cluster-actions"><button className="cluster-toggle" onClick={() => setExpandedCluster(expandedCluster === cluster.id ? null : cluster.id)}>{expandedCluster === cluster.id ? "Hide keywords" : "Show keywords"}</button><button className="button subtle" onClick={() => onCreateBrief(analysis.id, cluster)}>Create brief →</button></div>
          {expandedCluster === cluster.id && <ul>{cluster.keywords.map((keyword) => <li key={keyword}>{keyword}</li>)}</ul>}
        </article>)}</div>
      </section>

      <section className="pages-section"><div className="section-bar"><div><div className="eyebrow">Prioritized query inventory</div><h3>Keywords</h3></div></div><div className="table-wrap"><table><thead><tr><th>Keyword</th><th>Intent</th><th>Page</th><th>Priority</th><th>Cluster</th></tr></thead><tbody>{analysis.keywords.sort((a, b) => b.priority - a.priority).map((keyword) => <tr key={keyword.id}><td>{keyword.keyword}</td><td><span className={`intent-pill ${keyword.intent}`}>{intentLabel[keyword.intent]}</span></td><td>{keyword.pageType}</td><td><b>{keyword.priority}</b>/100</td><td>{analysis.clusters.find((cluster) => cluster.id === keyword.clusterId)?.name || keyword.clusterId}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

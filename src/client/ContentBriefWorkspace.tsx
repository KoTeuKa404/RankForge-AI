import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { contentBriefMarkdown } from "./content-brief-export";
import type {
  ContentBrief,
  ContentBriefStatus,
  ContentBriefSummary,
  KeywordCluster,
  KeywordPageType,
  Project,
  SearchIntent,
} from "../shared/types";

export interface BriefSeed {
  cluster: KeywordCluster;
  analysisId: string | null;
}

interface Props {
  authenticated: boolean;
  selectedProject: string;
  projects: Project[];
  onSelectProject: (id: string) => void;
  seed: BriefSeed | null;
  onSeedConsumed: () => void;
}

const intentOptions: SearchIntent[] = ["informational", "commercial", "transactional", "navigational", "local"];
const pageTypeOptions: KeywordPageType[] = ["guide", "comparison", "landing", "brand", "local-landing"];

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function seedCluster(): KeywordCluster {
  return {
    id: crypto.randomUUID(),
    name: "Technical SEO audit",
    primaryKeyword: "technical SEO audit",
    intent: "commercial",
    pageType: "comparison",
    suggestedSlug: "/technical-seo-audit/",
    confidence: 70,
    keywords: ["technical SEO audit", "website SEO audit", "SEO audit checklist"],
  };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export default function ContentBriefWorkspace({ authenticated, selectedProject, projects, onSelectProject, seed, onSeedConsumed }: Props) {
  const [cluster, setCluster] = useState<KeywordCluster>(seed?.cluster || seedCluster());
  const [sourceAnalysisId, setSourceAnalysisId] = useState<string | null>(seed?.analysisId || null);
  const [supporting, setSupporting] = useState((seed?.cluster || seedCluster()).keywords.join("\n"));
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [history, setHistory] = useState<ContentBriefSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!seed) return;
    setCluster(seed.cluster);
    setSupporting(seed.cluster.keywords.join("\n"));
    setSourceAnalysisId(seed.analysisId);
    setBrief(null);
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  useEffect(() => {
    if (!authenticated) return;
    api.contentBriefs(selectedProject || undefined).then((data) => setHistory(data.briefs)).catch(() => setHistory([]));
  }, [authenticated, selectedProject]);

  const metadataChecks = useMemo(() => brief ? {
    title: brief.title.length,
    description: brief.metaDescription.length,
    outline: brief.outline.length,
  } : null, [brief]);

  function updateCluster(patch: Partial<KeywordCluster>) {
    setCluster((current) => ({ ...current, ...patch }));
  }

  async function generate() {
    setLoading(true);
    setMessage("");
    try {
      const payload = { ...cluster, keywords: lines(supporting) };
      const result = await api.createContentBrief(payload, selectedProject || undefined, sourceAnalysisId || undefined);
      setBrief(result.brief);
      if (authenticated) {
        const data = await api.contentBriefs(selectedProject || undefined);
        setHistory(data.briefs);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Content brief generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function openBrief(id: string) {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.contentBriefById(id);
      setBrief(result.brief);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load content brief.");
    } finally {
      setLoading(false);
    }
  }

  function patchBrief(patch: Partial<ContentBrief>) {
    setBrief((current) => current ? { ...current, ...patch } : current);
  }

  async function save(status?: ContentBriefStatus) {
    if (!brief) return;
    if (!authenticated) {
      setMessage("Sign in with ChatGPT and use a project to save editorial changes.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await api.updateContentBrief(brief.id, { ...brief, status: status || brief.status });
      setBrief(result.brief);
      const data = await api.contentBriefs(selectedProject || undefined);
      setHistory(data.briefs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save content brief.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="content-panel brief-workspace">
    <div className="panel-heading">
      <div><div className="eyebrow">Content operations</div><h2>Build an implementation-ready content brief</h2></div>
      <div className="live-pill"><span/> Human approval required</div>
    </div>

    <div className="brief-layout">
      <section className="brief-seed-card">
        <div className="brief-form-grid">
          <label><span>Primary keyword</span><input value={cluster.primaryKeyword} onChange={(event) => updateCluster({ primaryKeyword: event.target.value, name: event.target.value })}/></label>
          <label><span>Suggested URL</span><input value={cluster.suggestedSlug} onChange={(event) => updateCluster({ suggestedSlug: event.target.value })}/></label>
          <label><span>Intent</span><select value={cluster.intent} onChange={(event) => updateCluster({ intent: event.target.value as SearchIntent })}>{intentOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Page type</span><select value={cluster.pageType} onChange={(event) => updateCluster({ pageType: event.target.value as KeywordPageType })}>{pageTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <label><span>Supporting keywords</span><textarea rows={7} value={supporting} onChange={(event) => setSupporting(event.target.value)} spellCheck={false}/></label>
        <div className="brief-seed-actions">
          <label><span>Project</span><select value={selectedProject} onChange={(event) => onSelectProject(event.target.value)}><option value="">Unsaved workspace</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <button className="button primary" onClick={generate} disabled={loading}>{loading ? <><i className="spinner"/> Generating…</> : <>Generate brief <span>→</span></>}</button>
        </div>
      </section>

      <aside className="brief-history-card">
        <div className="eyebrow">Editorial queue</div>
        {!authenticated ? <p>Sign in to persist briefs and workflow states.</p> : history.length === 0 ? <p>No saved content briefs yet.</p> : history.slice(0, 10).map((item) => <button key={item.id} onClick={() => openBrief(item.id)}><span><b>{item.name}</b><small>{item.primaryKeyword}</small><small>{new Date(item.updatedAt).toLocaleString()}</small></span><em className={`brief-status ${item.status}`}>{item.status}</em></button>)}
      </aside>
    </div>

    {message && <div className="alert">{message}</div>}

    {brief && <section className="brief-editor">
      <div className="brief-toolbar">
        <div><div className="eyebrow">Editorial document</div><h3>{brief.name}</h3></div>
        <div className="brief-toolbar-actions">
          <button className="button subtle" onClick={() => download("rankforge-content-brief.md", contentBriefMarkdown(brief), "text/markdown;charset=utf-8")}>Export Markdown</button>
          <button className="button subtle" onClick={() => download("rankforge-content-brief.json", JSON.stringify(brief, null, 2), "application/json")}>Export JSON</button>
          <button className="button primary" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="editor-health">
        <span className={metadataChecks && metadataChecks.title <= 60 ? "good" : "warn"}>Title {metadataChecks?.title}/60</span>
        <span className={metadataChecks && metadataChecks.description <= 160 ? "good" : "warn"}>Description {metadataChecks?.description}/160</span>
        <span className={metadataChecks && metadataChecks.outline >= 4 ? "good" : "warn"}>{metadataChecks?.outline} outline sections</span>
        <span className={`brief-status ${brief.status}`}>{brief.status}</span>
      </div>

      <div className="brief-editor-grid">
        <label><span>Brief name</span><input value={brief.name} onChange={(event) => patchBrief({ name: event.target.value })}/></label>
        <label><span>Suggested URL</span><input value={brief.suggestedSlug} onChange={(event) => patchBrief({ suggestedSlug: event.target.value })}/></label>
        <label className="wide"><span>SEO title</span><input value={brief.title} onChange={(event) => patchBrief({ title: event.target.value })}/></label>
        <label className="wide"><span>Meta description</span><textarea rows={3} value={brief.metaDescription} onChange={(event) => patchBrief({ metaDescription: event.target.value })}/></label>
        <label className="wide"><span>H1</span><input value={brief.h1} onChange={(event) => patchBrief({ h1: event.target.value })}/></label>
        <label className="wide"><span>Audience</span><textarea rows={3} value={brief.audience} onChange={(event) => patchBrief({ audience: event.target.value })}/></label>
        <label className="wide"><span>Search intent summary</span><textarea rows={3} value={brief.searchIntentSummary} onChange={(event) => patchBrief({ searchIntentSummary: event.target.value })}/></label>
        <label className="wide"><span>Content angle</span><textarea rows={3} value={brief.angle} onChange={(event) => patchBrief({ angle: event.target.value })}/></label>
      </div>

      <div className="outline-editor">
        <div className="section-bar"><div><div className="eyebrow">Structure</div><h3>Outline</h3></div><button className="button subtle" onClick={() => patchBrief({ outline: [...brief.outline, { id: crypto.randomUUID(), level: 2, heading: "New section", purpose: "Describe what this section must accomplish." }] })}>+ Section</button></div>
        {brief.outline.map((item, index) => <div className="outline-row" key={item.id}>
          <select value={item.level} onChange={(event) => patchBrief({ outline: brief.outline.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, level: Number(event.target.value) as 2 | 3 } : candidate) })}><option value={2}>H2</option><option value={3}>H3</option></select>
          <input value={item.heading} onChange={(event) => patchBrief({ outline: brief.outline.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, heading: event.target.value } : candidate) })}/>
          <input value={item.purpose} onChange={(event) => patchBrief({ outline: brief.outline.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, purpose: event.target.value } : candidate) })}/>
          <button aria-label="Remove section" onClick={() => patchBrief({ outline: brief.outline.filter((_, candidateIndex) => candidateIndex !== index) })}>×</button>
        </div>)}
      </div>

      <div className="brief-list-grid">
        <label><span>Questions to answer</span><textarea rows={8} value={brief.questions.join("\n")} onChange={(event) => patchBrief({ questions: lines(event.target.value) })}/></label>
        <label><span>Internal link ideas</span><textarea rows={8} value={brief.internalLinkIdeas.join("\n")} onChange={(event) => patchBrief({ internalLinkIdeas: lines(event.target.value) })}/></label>
        <label><span>Schema types</span><textarea rows={6} value={brief.schemaTypes.join("\n")} onChange={(event) => patchBrief({ schemaTypes: lines(event.target.value) })}/></label>
        <label><span>Quality checklist</span><textarea rows={6} value={brief.qualityChecklist.join("\n")} onChange={(event) => patchBrief({ qualityChecklist: lines(event.target.value) })}/></label>
      </div>

      <div className="editorial-actions"><span>Move through review only after a human checks claims and usefulness.</span><div><button className="button subtle" onClick={() => save("draft")}>Draft</button><button className="button subtle" onClick={() => save("review")}>Send to review</button><button className="button primary" onClick={() => save("approved")}>Approve</button></div></div>
    </section>}
  </div>;
}

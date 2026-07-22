import { useEffect, useMemo, useState } from "react";
import type {
  SearchConsoleConnectionStatus,
  SearchConsoleProperty,
  SearchConsoleSnapshot,
} from "../shared/search-console";
import type { Project } from "../shared/types";
import { api } from "./api";

interface Props {
  authenticated: boolean;
  selectedProject: string;
  projects: Project[];
  onSelectProject: (projectId: string) => void;
}

export default function SearchConsoleWorkspace({
  authenticated,
  selectedProject,
  projects,
  onSelectProject,
}: Props) {
  const [status, setStatus] = useState<SearchConsoleConnectionStatus | null>(null);
  const [properties, setProperties] = useState<SearchConsoleProperty[]>([]);
  const [snapshots, setSnapshots] = useState<SearchConsoleSnapshot[]>([]);
  const [days, setDays] = useState<7 | 28 | 90>(28);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const latest = snapshots[0] || null;
  const project = projects.find((item) => item.id === selectedProject) || null;

  async function load(): Promise<void> {
    if (!authenticated || !selectedProject) {
      setStatus(null);
      setProperties([]);
      setSnapshots([]);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const statusResult = await api.gscStatus(selectedProject);
      setStatus(statusResult.status);
      if (statusResult.status.connected) {
        const [propertyResult, snapshotResult] = await Promise.all([
          api.gscProperties(selectedProject),
          api.gscSnapshots(selectedProject),
        ]);
        setProperties(propertyResult.properties);
        setSnapshots(snapshotResult.snapshots);
      } else {
        setProperties([]);
        setSnapshots([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Search Console.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [authenticated, selectedProject]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    const result = params.get("gsc");
    if (projectId && projects.some((item) => item.id === projectId)) onSelectProject(projectId);
    if (result === "connected") setMessage("Google Search Console connected successfully.");
    if (result === "error") setMessage(params.get("reason") || "Google Search Console connection failed.");
    if (result) {
      params.delete("gsc");
      params.delete("reason");
      params.delete("projectId");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, [projects, onSelectProject]);

  async function connect() {
    if (!selectedProject) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await api.gscConnect(selectedProject);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Google authorization.");
      setLoading(false);
    }
  }

  async function selectProperty(siteUrl: string) {
    if (!selectedProject) return;
    setLoading(true);
    setMessage("");
    try {
      await api.gscSelectProperty(selectedProject, siteUrl);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not select property.");
      setLoading(false);
    }
  }

  async function sync() {
    if (!selectedProject) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await api.gscSync(selectedProject, days);
      setSnapshots((current) => [result.snapshot, ...current.filter((item) => item.id !== result.snapshot.id)]);
      setMessage(`Synced ${result.snapshot.rowCount} query/page rows.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search Console sync failed.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!selectedProject || !window.confirm("Disconnect Google Search Console from this project?")) return;
    setLoading(true);
    try {
      await api.gscDisconnect(selectedProject);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect Search Console.");
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    if (!latest) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const clicks = latest.rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = latest.rows.reduce((sum, row) => sum + row.impressions, 0);
    const weightedPosition = latest.rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
    return {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: impressions ? weightedPosition / impressions : 0,
    };
  }, [latest]);

  return <div className="content-panel">
    <div className="panel-heading">
      <div><div className="eyebrow">Search evidence</div><h2>Google Search Console</h2></div>
      <div className={`live-pill ${status?.connected ? "" : "muted"}`}><span/> {status?.connected ? "Connected" : "Not connected"}</div>
    </div>

    {!authenticated && <div className="empty-state"><h3>Sign in first</h3><p>Search Console connections are stored per authenticated RankForge project.</p></div>}

    {authenticated && <>
      <div className="search-toolbar">
        <label><span>Project</span><select value={selectedProject} onChange={(event) => onSelectProject(event.target.value)}><option value="">Select a project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {status?.connected ? <>
          <label><span>Property</span><select value={status.siteUrl || ""} onChange={(event) => selectProperty(event.target.value)}>{properties.map((item) => <option key={item.siteUrl} value={item.siteUrl}>{item.siteUrl}</option>)}</select></label>
          <label><span>Range</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 28 | 90)}><option value={7}>7 days</option><option value={28}>28 days</option><option value={90}>90 days</option></select></label>
          <button className="button primary" onClick={sync} disabled={loading || !status.siteUrl}>{loading ? "Syncing…" : "Sync data"}</button>
          <button className="button subtle" onClick={disconnect} disabled={loading}>Disconnect</button>
        </> : <button className="button primary" onClick={connect} disabled={loading || !selectedProject || !status?.configured}>{loading ? "Opening Google…" : "Connect Google"}</button>}
      </div>

      {project && <p className="workspace-note">Project root: <b>{project.rootUrl}</b></p>}
      {status && !status.configured && <div className="alert">Hosted secrets are missing: GSC_CLIENT_ID, GSC_CLIENT_SECRET, and GSC_TOKEN_SECRET.</div>}
      {message && <div className="alert">{message}</div>}

      {status?.connected && latest ? <>
        <section className="metric-grid search-metrics">
          <div className="metric neutral"><span>Clicks</span><strong>{Math.round(totals.clicks)}</strong><small>{latest.startDate} → {latest.endDate}</small></div>
          <div className="metric neutral"><span>Impressions</span><strong>{Math.round(totals.impressions)}</strong><small>{latest.rowCount} rows</small></div>
          <div className="metric neutral"><span>CTR</span><strong>{(totals.ctr * 100).toFixed(1)}%</strong><small>weighted</small></div>
          <div className="metric neutral"><span>Position</span><strong>{totals.position.toFixed(1)}</strong><small>impression weighted</small></div>
          <div className="metric high"><span>Opportunities</span><strong>{latest.opportunities.length}</strong><small>prioritized</small></div>
        </section>

        <section className="pages-section">
          <div className="section-bar"><div><div className="eyebrow">Prioritized by evidence</div><h3>Search opportunities</h3></div></div>
          <div className="table-wrap"><table><thead><tr><th>Score</th><th>Query</th><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th><th>Action</th></tr></thead><tbody>{latest.opportunities.slice(0, 100).map((item) => <tr key={item.id}><td><b>{item.score}</b></td><td>{item.query}</td><td><a href={item.page} target="_blank" rel="noreferrer">{item.page}</a></td><td>{item.clicks.toFixed(0)}</td><td>{item.impressions.toFixed(0)}</td><td>{(item.ctr * 100).toFixed(1)}%</td><td>{item.position.toFixed(1)}</td><td>{item.recommendation}</td></tr>)}</tbody></table></div>
        </section>
      </> : status?.connected && !loading ? <div className="empty-state"><h3>No Search Console snapshot yet</h3><p>Select the correct property and synchronize data to generate evidence-based opportunities.</p></div> : null}
    </>}
  </div>;
}

import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { MonitorCadence, MonitoringAlert, MonitoringConfig, Project } from "../shared/types";

interface Props {
  authenticated: boolean;
  projects: Project[];
}

export default function MonitoringWorkspace({ authenticated, projects }: Props) {
  const [monitors, setMonitors] = useState<MonitoringConfig[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [name, setName] = useState("Weekly technical SEO monitor");
  const [cadence, setCadence] = useState<MonitorCadence>("weekly");
  const [maxPages, setMaxPages] = useState(10);
  const [loadingId, setLoadingId] = useState("");
  const [message, setMessage] = useState("");

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

  async function refresh() {
    if (!authenticated) return;
    const [monitorData, alertData] = await Promise.all([api.monitors(), api.monitoringAlerts()]);
    setMonitors(monitorData.monitors);
    setAlerts(alertData.alerts);
  }

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    refresh().catch((error: Error) => setMessage(error.message));
  }, [authenticated]);

  async function create() {
    if (!selectedProject) return;
    setLoadingId("create");
    setMessage("");
    try {
      await api.createMonitor({ projectId: selectedProject.id, name, rootUrl: selectedProject.rootUrl, maxPages, cadence });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create monitor.");
    } finally {
      setLoadingId("");
    }
  }

  async function run(monitor: MonitoringConfig) {
    setLoadingId(monitor.id);
    setMessage("");
    try {
      const result = await api.runMonitor(monitor.id);
      if (!result.audit) setMessage(result.monitor.lastError || "The monitoring crawl failed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Monitoring run failed.");
    } finally {
      setLoadingId("");
    }
  }

  async function toggle(monitor: MonitoringConfig) {
    setLoadingId(monitor.id);
    try {
      await api.updateMonitor(monitor.id, !monitor.enabled);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update monitor.");
    } finally {
      setLoadingId("");
    }
  }

  async function read(alert: MonitoringAlert) {
    if (alert.readAt) return;
    await api.readMonitoringAlert(alert.id);
    setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, readAt: new Date().toISOString() } : item));
  }

  if (!authenticated) return <div className="content-panel"><div className="empty-state"><h3>Sign in to configure monitoring</h3><p>Local development can use DEV_USER_EMAIL on localhost. Production identity is still taken only from server-provided ChatGPT headers.</p></div></div>;

  return <div className="content-panel monitor-workspace">
    <div className="panel-heading"><div><div className="eyebrow">Regression monitoring</div><h2>Schedule bounded audits and surface changes</h2></div><div className="live-pill"><span/> External scheduler ready</div></div>

    <section className="monitor-create-card">
      <label><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.rootUrl}</option>)}</select></label>
      <label><span>Monitor name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)}/></label>
      <label><span>Cadence</span><select value={cadence} onChange={(event) => setCadence(event.target.value as MonitorCadence)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      <label><span>Pages</span><select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option></select></label>
      <button className="button primary" disabled={!selectedProject || loadingId === "create"} onClick={create}>{loadingId === "create" ? "Creating…" : "Create monitor"}</button>
      <p>Sites does not promise arbitrary long-running cron workers. The protected batch endpoint processes at most two due monitors per call and is designed for an external hourly scheduler.</p>
    </section>

    {message && <div className="alert">{message}</div>}

    <div className="monitor-grid">
      <section className="monitor-list-card">
        <div className="section-bar"><div><div className="eyebrow">Schedules</div><h3>Active monitors</h3></div></div>
        {monitors.length === 0 ? <div className="empty-row">Create a project and its first monitor.</div> : monitors.map((monitor) => <article className={`monitor-item ${monitor.enabled ? "" : "disabled"}`} key={monitor.id}>
          <div><div className="monitor-title"><h4>{monitor.name}</h4><span className={`monitor-state ${monitor.lastStatus}`}>{monitor.lastStatus}</span></div><a href={monitor.rootUrl} target="_blank" rel="noreferrer">{monitor.rootUrl}</a><p>{monitor.cadence} · {monitor.maxPages} pages · next {new Date(monitor.nextRunAt).toLocaleString()}</p>{monitor.lastError && <small>{monitor.lastError}</small>}</div>
          <div className="monitor-actions"><button className="button subtle" disabled={loadingId === monitor.id || monitor.lastStatus === "running"} onClick={() => run(monitor)}>Run now</button><button className="button subtle" disabled={loadingId === monitor.id} onClick={() => toggle(monitor)}>{monitor.enabled ? "Pause" : "Enable"}</button></div>
        </article>)}
      </section>

      <aside className="monitor-alert-card">
        <div className="section-bar"><div><div className="eyebrow">Alert inbox</div><h3>Regressions</h3></div><span className="unread-count">{alerts.filter((item) => !item.readAt).length} unread</span></div>
        {alerts.length === 0 ? <p>No monitoring alerts yet.</p> : alerts.slice(0, 30).map((alert) => <button key={alert.id} className={`${alert.severity} ${alert.readAt ? "read" : ""}`} onClick={() => read(alert)}><span className="alert-dot"/><span><b>{alert.title}</b><small>{alert.message}</small><time>{new Date(alert.createdAt).toLocaleString()}</time></span></button>)}
      </aside>
    </div>
  </div>;
}

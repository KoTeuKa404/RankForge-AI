import { useEffect, useState } from "react";
import type { Project, UserIdentity } from "../shared/types";
import { api } from "./api";
import SearchConsoleWorkspace from "./SearchConsoleWorkspace";

export default function SearchConsolePage() {
  const [identity, setIdentity] = useState<UserIdentity>({ authenticated: false });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState(() => new URLSearchParams(window.location.search).get("projectId") || "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.me().then(async (me) => {
      setIdentity(me);
      if (!me.authenticated) return;
      const result = await api.projects();
      setProjects(result.projects);
      if (!selectedProject && result.projects[0]) setSelectedProject(result.projects[0].id);
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  function chooseProject(projectId: string) {
    setSelectedProject(projectId);
    const params = new URLSearchParams(window.location.search);
    params.set("workspace", "search");
    if (projectId) params.set("projectId", projectId);
    else params.delete("projectId");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/?workspace=audit"><span className="brand-mark">R</span><span>RankForge <b>AI</b></span></a>
      <nav><a href="/?workspace=audit">Audit</a><a href="/?workspace=search" aria-current="page">Search Console</a></nav>
      {identity.authenticated
        ? <div className="identity"><span>{identity.name || identity.email}</span><a href="/signout-with-chatgpt">Sign out</a></div>
        : <a className="button ghost" href="/signin-with-chatgpt">Sign in with ChatGPT</a>}
    </header>
    <main id="top">
      <section className="hero compact-hero">
        <div className="eyebrow">Real search evidence</div>
        <h1>Connect crawl findings<br/><span>to Google performance.</span></h1>
        <p>Synchronize query and page metrics, then prioritize striking-distance rankings and low-CTR opportunities.</p>
      </section>
      {message && <div className="alert">{message}</div>}
      <section className="workspace search-workspace">
        <SearchConsoleWorkspace
          authenticated={identity.authenticated}
          selectedProject={selectedProject}
          projects={projects}
          onSelectProject={chooseProject}
        />
      </section>
    </main>
    <footer><span>RankForge AI v1.0 RC</span><span>Search Console data stays scoped to the authenticated project.</span></footer>
  </div>;
}

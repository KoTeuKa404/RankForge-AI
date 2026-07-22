import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SearchConsolePage from "./SearchConsolePage";
import "./styles.css";
import "./async-jobs.css";

const workspace = new URLSearchParams(window.location.search).get("workspace");
const content = workspace === "search"
  ? <SearchConsolePage />
  : <><App/><a className="global-search-link" href="/?workspace=search">◎ Search Console</a></>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{content}</StrictMode>,
);

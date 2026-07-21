import { parse } from "node-html-parser";
import type { AuditResult, PageAudit, SeoIssue, Severity } from "../shared/types";
import { canonicalizeCrawlUrl, normalizeTargetUrl, safeFetchText, TargetValidationError } from "./security";

interface CrawlOptions {
  maxPages: number;
}

interface RobotsRules {
  disallow: string[];
}

const severityPenalty: Record<Severity, number> = {
  critical: 15,
  high: 7,
  medium: 3,
  low: 1,
};

function text(element: ReturnType<typeof parse> | null | undefined): string {
  return element?.textContent.replace(/\s+/g, " ").trim() || "";
}

function attr(root: ReturnType<typeof parse>, selector: string, name: string): string {
  return root.querySelector(selector)?.getAttribute(name)?.trim() || "";
}

function makeIssue(
  code: string,
  severity: Severity,
  title: string,
  description: string,
  recommendation: string,
  url?: string,
  evidence?: string,
): SeoIssue {
  return {
    id: crypto.randomUUID(),
    code,
    severity,
    title,
    description,
    recommendation,
    url,
    evidence,
  };
}

export function analyzeHtml(html: string, pageUrl: string, status = 200, loadTimeMs = 0): PageAudit {
  const root = parse(html, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true,
    },
  });
  const base = new URL(pageUrl);
  const internal = new Set<string>();
  const external = new Set<string>();

  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") || "";
    try {
      const url = new URL(href, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      if (url.origin === base.origin) internal.add(url.toString());
      else external.add(url.toString());
    } catch {
      // Ignore malformed links; the issue engine handles only resolvable links.
    }
  }

  const bodyText = root.querySelector("body")?.textContent || "";
  const wordCount = bodyText
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const images = root.querySelectorAll("img");

  return {
    url: pageUrl,
    status,
    contentType: "text/html",
    loadTimeMs,
    title: text(root.querySelector("title")),
    description: attr(root, 'meta[name="description" i]', "content"),
    canonical: attr(root, 'link[rel="canonical" i]', "href"),
    robots: attr(root, 'meta[name="robots" i]', "content"),
    lang: root.querySelector("html")?.getAttribute("lang")?.trim() || "",
    h1: root.querySelectorAll("h1").map((node) => text(node)).filter(Boolean),
    headingCount: root.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    wordCount,
    imageCount: images.length,
    imagesMissingAlt: images.filter((image) => !image.hasAttribute("alt") || !image.getAttribute("alt")?.trim()).length,
    internalLinks: [...internal],
    externalLinks: [...external],
    schemaCount: root.querySelectorAll('script[type="application/ld+json" i]').length,
    ogTitle: attr(root, 'meta[property="og:title" i]', "content"),
    ogDescription: attr(root, 'meta[property="og:description" i]', "content"),
    incomingLinks: 0,
  };
}

export function evaluatePage(page: PageAudit): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const pageUrl = page.url;

  if (page.status >= 500) {
    issues.push(makeIssue("http-5xx", "critical", "Server error", "The page returned a server error.", "Fix the application or upstream failure and verify that the URL returns a stable 2xx response.", pageUrl, `HTTP ${page.status}`));
  } else if (page.status === 404) {
    issues.push(makeIssue("http-404", "high", "Page not found", "An internal URL returns 404.", "Restore the page, correct internal links, or add a relevant 301 redirect.", pageUrl));
  } else if (page.status >= 300) {
    issues.push(makeIssue("http-non-2xx", "medium", "Non-2xx response", "The crawled URL did not return a direct successful response.", "Link directly to the final canonical 2xx URL.", pageUrl, `HTTP ${page.status}`));
  }

  if (!page.title) {
    issues.push(makeIssue("title-missing", "high", "Missing title", "The page has no HTML title.", "Add a unique, descriptive title that matches the page intent.", pageUrl));
  } else if (page.title.length < 20) {
    issues.push(makeIssue("title-short", "low", "Title may be too short", "The title provides little context.", "Expand it with the primary topic and differentiating value without keyword stuffing.", pageUrl, `${page.title.length} characters`));
  } else if (page.title.length > 65) {
    issues.push(makeIssue("title-long", "medium", "Title may be truncated", "The title is likely too long for many search result layouts.", "Rewrite the title to preserve the core intent within roughly 50–65 characters.", pageUrl, `${page.title.length} characters`));
  }

  if (!page.description) {
    issues.push(makeIssue("description-missing", "medium", "Missing meta description", "The page has no meta description.", "Add a unique summary aligned with the search intent and page content.", pageUrl));
  } else if (page.description.length < 70) {
    issues.push(makeIssue("description-short", "low", "Meta description may be too short", "The description may not communicate enough value.", "Write a concise, useful description that accurately summarizes the page.", pageUrl, `${page.description.length} characters`));
  } else if (page.description.length > 170) {
    issues.push(makeIssue("description-long", "low", "Meta description may be truncated", "The description is longer than typical result snippets.", "Shorten it while preserving the page benefit and intent.", pageUrl, `${page.description.length} characters`));
  }

  if (page.h1.length === 0) {
    issues.push(makeIssue("h1-missing", "high", "Missing H1", "The page has no primary visible heading.", "Add one clear H1 describing the main purpose of the page.", pageUrl));
  } else if (page.h1.length > 1) {
    issues.push(makeIssue("h1-multiple", "medium", "Multiple H1 headings", "The page has more than one primary heading.", "Use a single primary H1 and structure subsections with H2/H3 headings.", pageUrl, `${page.h1.length} H1 elements`));
  }

  if (!page.canonical) {
    issues.push(makeIssue("canonical-missing", "medium", "Missing canonical", "The page does not declare a canonical URL.", "Add a self-referencing canonical or the intended preferred URL.", pageUrl));
  } else {
    try {
      const canonical = new URL(page.canonical, pageUrl);
      if (canonical.protocol !== "https:" && canonical.protocol !== "http:") throw new Error();
    } catch {
      issues.push(makeIssue("canonical-invalid", "high", "Invalid canonical", "The canonical URL cannot be resolved.", "Use an absolute, valid HTTP or HTTPS canonical URL.", pageUrl, page.canonical));
    }
  }

  if (/\bnoindex\b/i.test(page.robots)) {
    issues.push(makeIssue("meta-noindex", "high", "Page is marked noindex", "Search engines are instructed not to index this page.", "Confirm that noindex is intentional; otherwise remove it and request recrawling.", pageUrl, page.robots));
  }
  if (!page.lang) {
    issues.push(makeIssue("lang-missing", "low", "Missing document language", "The html element has no lang attribute.", "Set a valid BCP 47 language code such as en, uk, or en-US.", pageUrl));
  }
  if (page.wordCount < 150) {
    issues.push(makeIssue("thin-content", "medium", "Very little indexable text", "The page contains limited visible text and may not satisfy its intended query.", "Add genuinely useful content or consolidate this URL with a stronger page.", pageUrl, `${page.wordCount} words`));
  }
  if (page.imagesMissingAlt > 0) {
    issues.push(makeIssue("image-alt-missing", "low", "Images missing alt text", "Some images do not provide alternative text.", "Add concise alt text to meaningful images and empty alt attributes to decorative images.", pageUrl, `${page.imagesMissingAlt} of ${page.imageCount} images`));
  }
  if (!page.ogTitle || !page.ogDescription) {
    issues.push(makeIssue("open-graph-incomplete", "low", "Incomplete Open Graph metadata", "Shared links may have inconsistent previews.", "Add og:title and og:description that accurately represent the page.", pageUrl));
  }
  if (page.loadTimeMs > 3_000) {
    issues.push(makeIssue("slow-response", "medium", "Slow server response", "The page fetch took more than three seconds from the audit runtime.", "Measure server timing and optimize origin latency, caching, and expensive backend work.", pageUrl, `${page.loadTimeMs} ms`));
  }

  return issues;
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}`);
}

function parseRobots(body: string): RobotsRules {
  const disallow: string[] = [];
  let applies = false;

  for (const originalLine of body.split(/\r?\n/)) {
    const line = originalLine.split("#", 1)[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") applies = value === "*" || value.toLowerCase().includes("rankforgebot");
    else if (field === "disallow" && applies && value) disallow.push(value);
  }
  return { disallow };
}

function isAllowedByRobots(url: URL, rules: RobotsRules): boolean {
  const path = `${url.pathname}${url.search}`;
  return !rules.disallow.some((rule) => wildcardToRegex(rule).test(path));
}

async function loadRobots(root: URL): Promise<{ rules: RobotsRules; found: boolean }> {
  try {
    const result = await safeFetchText(new URL("/robots.txt", root));
    if (result.response.ok) return { rules: parseRobots(result.body), found: true };
  } catch {
    // Absence or network failure is reported separately but does not block the crawl.
  }
  return { rules: { disallow: [] }, found: false };
}

async function sitemapExists(root: URL): Promise<boolean> {
  try {
    const result = await safeFetchText(new URL("/sitemap.xml", root), { method: "GET" });
    return result.response.ok && /<(?:urlset|sitemapindex)\b/i.test(result.body);
  } catch {
    return false;
  }
}

function addSiteWideIssues(pages: PageAudit[], issues: SeoIssue[], rootUrl: string, robotsFound: boolean, sitemapFound: boolean): void {
  const duplicateMap = (key: "title" | "description", code: string, label: string) => {
    const groups = new Map<string, PageAudit[]>();
    for (const page of pages) {
      const value = page[key].trim().toLowerCase();
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), page]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      issues.push(makeIssue(code, "high", `Duplicate ${label}`, `${group.length} crawled pages use the same ${label}.`, `Write a unique ${label} for each indexable page or consolidate duplicate URLs.`, group[0].url, group.map((page) => page.url).join("\n")));
    }
  };

  duplicateMap("title", "duplicate-title", "title");
  duplicateMap("description", "duplicate-description", "meta description");

  const pageByUrl = new Map(pages.map((page) => [page.url, page]));
  for (const page of pages) {
    for (const linked of page.internalLinks) {
      const canonical = canonicalizeCrawlUrl(linked, new URL(rootUrl));
      const target = canonical ? pageByUrl.get(canonical) : undefined;
      if (target) target.incomingLinks += 1;
    }
  }

  for (const page of pages) {
    if (page.url !== rootUrl && page.incomingLinks === 0) {
      issues.push(makeIssue("orphan-in-crawl", "medium", "Page has no discovered incoming links", "No crawled page links to this URL.", "Add a relevant internal link from an indexable hub or navigation path.", page.url));
    }
  }

  if (!robotsFound) {
    issues.push(makeIssue("robots-missing", "low", "robots.txt not found", "The standard robots.txt endpoint did not return a successful response.", "Publish a deliberate robots.txt file, even if it allows all public crawling.", rootUrl));
  }
  if (!sitemapFound) {
    issues.push(makeIssue("sitemap-missing", "medium", "XML sitemap not found", "No valid sitemap.xml was detected at the conventional location.", "Publish an XML sitemap containing canonical, indexable URLs and reference it in robots.txt.", rootUrl));
  }
}

export function calculateScore(issues: SeoIssue[]): number {
  const penalty = issues.reduce((total, issue) => total + severityPenalty[issue.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export async function auditSite(rawUrl: string, options: CrawlOptions): Promise<AuditResult> {
  const startedAt = new Date();
  const root = normalizeTargetUrl(rawUrl);
  root.pathname = root.pathname || "/";
  root.hash = "";
  const maxPages = Math.max(1, Math.min(25, Math.floor(options.maxPages || 10)));
  const { rules, found: robotsTxtFound } = await loadRobots(root);
  const sitemapFound = await sitemapExists(root);
  const queue: string[] = [root.toString()];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pages: PageAudit[] = [];
  const issues: SeoIssue[] = [];
  let stoppedReason: string | undefined;

  while (queue.length && pages.length < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    const url = new URL(next);

    if (!isAllowedByRobots(url, rules)) {
      issues.push(makeIssue("robots-blocked", "low", "URL blocked by robots.txt", "The crawler skipped this URL because robots.txt disallows it.", "Review the directive only if this URL should be crawlable by search engines.", next));
      continue;
    }

    try {
      const fetched = await safeFetchText(url);
      const contentType = fetched.response.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) continue;

      const finalUrl = canonicalizeCrawlUrl(fetched.finalUrl.toString(), root) || fetched.finalUrl.toString();
      const page = analyzeHtml(fetched.body, finalUrl, fetched.response.status, fetched.durationMs);
      page.contentType = contentType;
      pages.push(page);
      issues.push(...evaluatePage(page));

      for (const link of page.internalLinks) {
        const canonical = canonicalizeCrawlUrl(link, root);
        if (canonical && !queued.has(canonical) && !visited.has(canonical)) {
          queued.add(canonical);
          queue.push(canonical);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch failure";
      issues.push(makeIssue("crawl-failed", "high", "Page could not be crawled", message, "Verify that the page is publicly reachable and returns valid HTML.", next));
    }
  }

  if (queue.length > 0) stoppedReason = `Reached the configured limit of ${maxPages} pages.`;
  if (pages.length === 0) {
    const reason = issues.find((issue) => issue.code === "crawl-failed")?.description;
    throw new TargetValidationError(reason ? `No HTML pages could be audited: ${reason}` : "No HTML pages could be audited.");
  }

  const normalizedRoot = pages[0].url;
  addSiteWideIssues(pages, issues, normalizedRoot, robotsTxtFound, sitemapFound);

  return {
    id: crypto.randomUUID(),
    rootUrl: normalizedRoot,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    score: calculateScore(issues),
    pagesScanned: pages.length,
    issues,
    pages,
    robotsTxtFound,
    sitemapFound,
    stoppedReason,
  };
}

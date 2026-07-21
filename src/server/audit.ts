import { parse } from "node-html-parser";
import type { AuditResult, PageAudit, SeoIssue, Severity } from "../shared/types";
import { canonicalizeCrawlUrl, normalizeTargetUrl, safeFetchText, TargetValidationError } from "./security";

interface CrawlOptions {
  maxPages: number;
}

interface RobotsRules {
  disallow: string[];
  sitemaps: string[];
}

interface ScoreBucket {
  count: number;
  affectedUrls: Set<string>;
}

const severityBasePenalty: Record<Severity, number> = {
  critical: 18,
  high: 7,
  medium: 3,
  low: 1,
};

const severityPenaltyCap: Record<Severity, number> = {
  critical: 45,
  high: 35,
  medium: 18,
  low: 7,
};

const issuePenaltyCap: Record<Severity, number> = {
  critical: 30,
  high: 14,
  medium: 7,
  low: 3,
};

const MAX_QUERY_VARIANTS_PER_PATH = 5;

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

function visibleBodyText(root: ReturnType<typeof parse>): string {
  for (const node of root.querySelectorAll("script,style,noscript,template,svg")) node.remove();
  return root.querySelector("body")?.textContent || "";
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

  const schemaCount = root.querySelectorAll('script[type="application/ld+json" i]').length;
  const bodyText = visibleBodyText(root);
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
    imagesMissingAlt: images.filter((image) => !image.hasAttribute("alt")).length,
    internalLinks: [...internal],
    externalLinks: [...external],
    schemaCount,
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
  const sitemaps: string[] = [];
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
    else if (field === "sitemap" && value) sitemaps.push(value);
  }
  return { disallow, sitemaps };
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
  return { rules: { disallow: [], sitemaps: [] }, found: false };
}

async function sitemapExists(root: URL, declaredSitemaps: string[]): Promise<boolean> {
  const declared = declaredSitemaps.map((value) => {
    try { return new URL(value, root).toString(); } catch { return ""; }
  }).filter(Boolean);
  const candidates = [new URL("/sitemap.xml", root).toString(), ...declared].filter((value, index, values) => values.indexOf(value) === index).slice(0, 4);
  for (const candidate of candidates) {
    try {
      const result = await safeFetchText(candidate, { method: "GET" });
      if (result.response.ok && /<(?:urlset|sitemapindex)\b/i.test(result.body)) return true;
    } catch {
      // Try the next declared sitemap before reporting the site-wide issue.
    }
  }
  return false;
}

function addSiteWideIssues(pages: PageAudit[], issues: SeoIssue[], rootUrl: string, robotsFound: boolean, sitemapFound: boolean): void {
  const duplicateMap = (key: "title" | "description", code: string, label: string) => {
    const groups = new Map<string, PageAudit[]>();
    for (const page of pages) {
      const value = page[key].trim().toLowerCase();
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), page]);
    }

    const affectedUrls = new Set<string>();
    const evidence: string[] = [];
    for (const [value, group] of groups) {
      if (group.length < 2) continue;
      const urls = group.map((page) => page.url);
      urls.forEach((url) => affectedUrls.add(url));
      evidence.push(`Shared ${label}: ${value.slice(0, 240)}\n${urls.join("\n")}`);
    }

    if (affectedUrls.size > 0) {
      const urls = [...affectedUrls];
      issues.push(makeIssue(
        code,
        "high",
        `Duplicate ${label}`,
        `${urls.length} crawled pages participate in duplicate ${label} groups.`,
        `Write a unique ${label} for each indexable page or consolidate duplicate URLs.`,
        urls[0],
        evidence.join("\n\n"),
      ));
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
    issues.push(makeIssue("sitemap-missing", "medium", "XML sitemap not found", "No valid sitemap was detected at the conventional location or in robots.txt.", "Publish an XML sitemap containing canonical, indexable URLs and reference it in robots.txt.", rootUrl));
  }
}

export function groupIssues(issues: SeoIssue[]): SeoIssue[] {
  const groups = new Map<string, { first: SeoIssue; urls: Set<string>; evidence: Set<string> }>();

  for (const issue of issues) {
    const key = `${issue.code}|${issue.severity}|${issue.title}|${issue.recommendation}`;
    const current = groups.get(key) || { first: issue, urls: new Set<string>(), evidence: new Set<string>() };
    if (issue.url) current.urls.add(issue.url);
    if (issue.evidence) current.evidence.add(issue.evidence.trim());
    groups.set(key, current);
  }

  return [...groups.values()].map(({ first, urls, evidence }) => {
    const affectedUrls = [...urls];
    const evidenceBlocks = [...evidence].filter(Boolean);
    if (affectedUrls.length > 1) evidenceBlocks.push(`Affected URLs:\n${affectedUrls.join("\n")}`);

    return {
      ...first,
      id: crypto.randomUUID(),
      url: affectedUrls[0] || first.url,
      description: affectedUrls.length > 1
        ? `${affectedUrls.length} crawled pages are affected. ${first.description}`
        : first.description,
      evidence: evidenceBlocks.length > 0 ? evidenceBlocks.join("\n\n") : undefined,
    };
  });
}

export function calculateScore(issues: SeoIssue[], pagesScanned = 1): number {
  const pageCount = Math.max(1, pagesScanned);
  const grouped = new Map<string, ScoreBucket>();

  for (const issue of issues) {
    const key = `${issue.code}|${issue.severity}`;
    const bucket = grouped.get(key) || { count: 0, affectedUrls: new Set<string>() };
    bucket.count += 1;
    if (issue.url) bucket.affectedUrls.add(issue.url);
    for (const match of issue.evidence?.match(/^https?:\/\/\S+$/gm) || []) bucket.affectedUrls.add(match.trim());
    grouped.set(key, bucket);
  }

  const severityTotals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const [key, bucket] of grouped) {
    const severity = key.slice(key.lastIndexOf("|") + 1) as Severity;
    const affected = Math.max(bucket.count, bucket.affectedUrls.size, 1);
    const prevalence = Math.min(1, affected / pageCount);
    const breadthMultiplier = 1 + Math.min(1, Math.log2(affected + 1) / 4) + Math.min(0.35, prevalence * 0.35);
    const penalty = Math.min(issuePenaltyCap[severity], severityBasePenalty[severity] * breadthMultiplier);
    severityTotals[severity] += penalty;
  }

  const penalty = (Object.keys(severityTotals) as Severity[])
    .reduce((total, severity) => total + Math.min(severityTotals[severity], severityPenaltyCap[severity]), 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function createQueryVariantGuard(): (raw: string) => boolean {
  const variantsByPath = new Map<string, Set<string>>();
  return (raw: string) => {
    const url = new URL(raw);
    if (!url.search) return true;
    const variants = variantsByPath.get(url.pathname) || new Set<string>();
    if (variants.has(url.search)) return true;
    if (variants.size >= MAX_QUERY_VARIANTS_PER_PATH) return false;
    variants.add(url.search);
    variantsByPath.set(url.pathname, variants);
    return true;
  };
}

function addNonHtmlStatusIssue(issues: SeoIssue[], url: string, status: number): void {
  if (status >= 500) {
    issues.push(makeIssue("http-5xx", "critical", "Server error", "The URL returned a server error.", "Fix the upstream failure and verify that the URL returns a stable response.", url, `HTTP ${status}`));
  } else if (status === 404) {
    issues.push(makeIssue("http-404", "high", "Page not found", "An internal URL returns 404.", "Restore the resource, correct internal links, or add a relevant 301 redirect.", url));
  } else if (status >= 400) {
    issues.push(makeIssue("http-4xx", "high", "Client error response", "An internal URL returned a client error.", "Correct the internal link or make the target publicly accessible.", url, `HTTP ${status}`));
  }
}

export async function auditSite(rawUrl: string, options: CrawlOptions): Promise<AuditResult> {
  const startedAt = new Date();
  const root = normalizeTargetUrl(rawUrl);
  root.pathname = root.pathname || "/";
  root.hash = "";
  const maxPages = Math.max(1, Math.min(25, Math.floor(options.maxPages || 10)));
  let crawlBase = root;
  let robotsResult = await loadRobots(crawlBase);
  let rules = robotsResult.rules;
  let robotsTxtFound = robotsResult.found;
  let sitemapFound = await sitemapExists(crawlBase, rules.sitemaps);
  const queue: string[] = [root.toString()];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const auditedFinalUrls = new Set<string>();
  const allowQueryVariant = createQueryVariantGuard();
  allowQueryVariant(root.toString());
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
      let finalUrl = canonicalizeCrawlUrl(fetched.finalUrl.toString(), crawlBase);
      if (!finalUrl && pages.length === 0 && auditedFinalUrls.size === 0) {
        crawlBase = normalizeTargetUrl(fetched.finalUrl.toString());
        robotsResult = await loadRobots(crawlBase);
        rules = robotsResult.rules;
        robotsTxtFound = robotsResult.found;
        sitemapFound = await sitemapExists(crawlBase, rules.sitemaps);
        finalUrl = canonicalizeCrawlUrl(fetched.finalUrl.toString(), crawlBase);
        if (finalUrl) allowQueryVariant(finalUrl);
      }
      if (!finalUrl) {
        issues.push(makeIssue("external-redirect", "medium", "Internal URL redirects off-site", "The URL redirects to a different origin, so the crawler did not analyze the destination.", "Review the redirect and keep internal navigation on the intended site when appropriate.", next, fetched.finalUrl.toString()));
        continue;
      }
      if (auditedFinalUrls.has(finalUrl)) continue;
      auditedFinalUrls.add(finalUrl);

      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        addNonHtmlStatusIssue(issues, finalUrl, fetched.response.status);
        continue;
      }

      const page = analyzeHtml(fetched.body, finalUrl, fetched.response.status, fetched.durationMs);
      page.contentType = contentType;
      pages.push(page);
      issues.push(...evaluatePage(page));

      for (const link of page.internalLinks) {
        const canonical = canonicalizeCrawlUrl(link, crawlBase);
        if (!canonical || queued.has(canonical) || visited.has(canonical)) continue;
        if (!allowQueryVariant(canonical)) continue;
        queued.add(canonical);
        queue.push(canonical);
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
  const score = calculateScore(issues, pages.length);
  const groupedIssues = groupIssues(issues);

  return {
    id: crypto.randomUUID(),
    rootUrl: normalizedRoot,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    score,
    pagesScanned: pages.length,
    issues: groupedIssues,
    pages,
    robotsTxtFound,
    sitemapFound,
    stoppedReason,
  };
}

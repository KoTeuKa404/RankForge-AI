# RankForge AI roadmap

## Current release

Status: `1.0.0-rc.1` implemented in `main`; local and hosted acceptance validation is required before promoting to stable `1.0.0`.

## 1.0 product scope

### Technical audit and crawler — implemented

- public product interface and optional Sign in with ChatGPT
- projects, durable audit history, and before/after comparisons
- bounded same-origin crawling
- technical and on-page issue engine
- grouped template findings and normalized score
- robots.txt groups, Allow/Disallow precedence, bounded crawl delay
- sitemap and sitemap-index traversal with URL seeding
- tracking-parameter cleanup, query-variant limits, redirects, and final-URL deduplication
- CSV, JSON, standalone HTML, and R2 JSON exports

### Production execution and security — implemented

- D1 audit jobs with queued/running/completed/failed states
- Cloudflare Queue producer and consumer
- retry policy and dead-letter queue configuration
- scheduled stale-job recovery
- Worker execution-context fallback when Queue is unavailable
- phase-aware progress and failed-job retry UI
- literal private/local/reserved target blocking
- A/AAAA DNS-over-HTTPS preflight before every fetch and redirect
- response timeout, response-size limits, standard-port restrictions, and credential rejection
- monthly audit, AI, Search Console, and crawl-page usage controls
- production dependency audit, CI, release contract, accessibility contracts, and runtime smoke test

### Keyword and content operations — implemented

- keyword import from pasted text and CSV-like input
- deterministic clustering and multilingual intent classification
- primary/secondary keyword selection
- overlap and cannibalization warnings
- content maps and page-type suggestions
- editable content briefs
- draft/review/approved editorial states
- title, description, H1, outline, questions, schema, and quality checklist suggestions

### Internal linking — implemented

- crawl-grounded contextual suggestions
- orphan and underlinked-page detection
- anchor suggestions and confidence values
- saved link plans
- Gemini Embedding 2 semantic relevance enhancement
- deterministic fallback when embeddings are unavailable

### Google Search Console — implemented

- OAuth authorization and state validation
- encrypted access and refresh token storage
- automatic token refresh
- property discovery and selection
- 7, 28, and 90 day query/page ingestion
- clicks, impressions, CTR, and position summaries
- striking-distance, low-CTR, and high-impression opportunity scoring
- saved Search Console snapshots

### Monitoring and AI remediation — implemented

- monitor configurations and manual runs
- scheduled due-monitor processing
- comparisons and alerts
- Gemini and OpenAI AI Fix providers
- automatic provider fallback
- grouped-page context for template-level fixes
- server-side AI recommendation quality evaluation
- rejection of manipulative recommendations and unsupported ranking guarantees

## Stable 1.0 acceptance gate

The following are release verification tasks rather than missing product features:

1. regenerate and commit `package-lock.json` for `1.0.0-rc.1`;
2. run all eight D1 migrations locally;
3. pass `npm run check` on Node.js 22;
4. pass local runtime `npm run smoke`;
5. create and bind production D1, R2, Queue, and dead-letter Queue resources;
6. apply remote migrations and pass the hosted smoke test;
7. verify Google OAuth using the exact hosted callback URL;
8. verify one 25-page Queue crawl, retry/recovery, R2 report, semantic links, AI Fix, and scheduled monitoring;
9. complete responsive, keyboard, and manual accessibility review;
10. change the version to `1.0.0`, synchronize the lockfile, tag `v1.0.0`, and publish.

The full procedure is in `PRODUCTION_DEPLOYMENT.md`.

## Post-1.0 roadmap

These items are intentionally outside the initial stable release:

- crawl limits above 25 pages and distributed crawl partitions
- live third-party keyword-volume and paid-difficulty provider adapters
- SERP snapshot provider and source citation workflow
- WordPress and other CMS draft publishing adapters
- graph visualization and anchor-diversity reporting
- multi-user roles, organizations, and granular project permissions
- external Slack/email/webhook alerts
- white-label reports and multi-site portfolio dashboard
- billing plans and payment processing
- historical embedding storage and large-scale vector indexing
- full Playwright cross-browser suite in hosted CI

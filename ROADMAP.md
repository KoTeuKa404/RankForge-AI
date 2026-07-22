# RankForge AI roadmap

## Stage 1 — Technical Audit MVP

Status: implemented.

- public product page
- optional Sign in with ChatGPT
- projects and audit history
- bounded same-origin crawl
- technical/on-page issue engine
- grouped findings and normalized SEO score
- CSV, JSON, and HTML exports
- Gemini and OpenAI AI Fix providers
- D1 schema, rate limits, tests, and security baseline

## Stage 2 — Production hardening

Status: v0.7 beta implemented; durable execution remains in progress.

Implemented:

- redirect destination validation
- tracking-parameter cleanup and query-variant limits
- duplicate final-URL protection
- robots user-agent group selection
- Allow/Disallow longest-match precedence
- bounded Crawl-delay support
- sitemap.xml and robots-declared sitemap discovery
- sitemap-index traversal and sitemap URL seeding
- regression comparison between audits
- D1-backed asynchronous audit job records
- queued/running/completed/failed job states
- browser polling and progress heartbeat
- failed-job retry endpoint with a three-attempt limit
- R2 JSON report artifacts and protected download endpoint
- production-only dependency audit command
- CI validation on main

Remaining:

- pre-connect DNS resolution and private-address rejection through a hardened fetch gateway
- durable Queue/Workflow execution beyond Worker `waitUntil`
- stale-running-job recovery and idempotent queue consumers
- true page-by-page progress emitted directly by the crawler
- browser-level end-to-end tests
- accessibility audit
- richer redirect-chain reporting
- crawl budget and per-project usage controls

## Stage 3 — Keyword intelligence

Status: beta implemented.

Implemented:

- keyword import from pasted text/CSV-like input
- deterministic clustering
- intent classification
- primary/secondary keyword selection
- overlap and cannibalization warnings
- content map suggestions by page type

Remaining:

- embeddings-based clustering provider
- search-volume and difficulty provider adapters
- Google Search Console query ingestion
- clustering evaluation dataset

## Stage 4 — Content operations

Status: beta implemented.

Implemented:

- content brief generator
- editable briefs
- editorial draft/review/approved states
- title, meta description, H1, outline, questions, schema, and checklist suggestions

Remaining:

- live SERP/provider adapters
- source citation workflow
- content quality scoring
- WordPress draft publishing adapter
- standalone schema markup generator and validator

## Stage 5 — Internal linking and Search Console

Status: partially implemented.

Implemented:

- internal-link suggestions
- orphan and underlinked-page detection
- anchor suggestions and confidence values
- saved internal-link analyses

Remaining:

- semantic embeddings for link relevance
- depth and graph visualization
- anchor diversity checks
- Google Search Console OAuth integration
- query/page performance ingestion
- change annotations and opportunity scoring

## Stage 6 — Full SearchOps platform

Status: partially implemented.

Implemented:

- monitoring configurations
- scheduled-run endpoint
- audit comparisons
- monitoring alerts

Remaining:

- production scheduler deployment validation
- team roles and project permissions
- external alerts and webhooks
- white-label reports
- multi-site portfolio dashboard
- evaluation suite for AI recommendations
- cost and usage controls
- billing and plan limits

## Planned releases

### v0.7 beta — asynchronous crawler

- D1 audit jobs
- progress polling
- retry endpoint
- R2 report artifacts

### v0.8 beta — search evidence

- Google Search Console OAuth
- query/page ingestion
- search-volume and difficulty adapters
- semantic clustering and internal links

### v0.9 release candidate — deployment hardening

- durable queue/workflow runner
- hardened DNS fetch gateway
- browser E2E and accessibility tests
- usage limits and evaluation suite

### v1.0

A user can connect a site, crawl it safely at useful scale, combine crawl and Search Console evidence, prioritize issues, generate reviewable fixes and content briefs, track implementation, and demonstrate measurable before/after changes without relying on opaque or manipulative SEO tactics.

# RankForge AI roadmap

## Stage 1 — Technical Audit MVP (this commit)

Status: implemented.

- public product page
- optional Sign in with ChatGPT
- projects and audit history
- bounded same-origin crawl
- technical/on-page issue engine
- SEO score and exports
- AI Fix endpoint
- D1 schema, rate limits, tests, security baseline

## Stage 2 — Production hardening

- pre-connect DNS resolution and private-address rejection through an external hardened fetch service
- robots allow/disallow precedence and crawl-delay support
- sitemap index discovery and sitemap URL seeding
- crawl job chunking for runtime limits
- idempotent job records and progress polling
- regression comparison between audits
- CSV export and stored R2 report artifacts
- accessibility audit and browser-level end-to-end tests

## Stage 3 — Keyword intelligence

- CSV keyword import
- embeddings-based clustering
- intent classification
- primary/secondary keyword selection
- cannibalization candidates
- content map by URL and page type

## Stage 4 — Content operations

- content brief generator
- SERP/provider adapters
- editorial approval states
- content quality checks
- WordPress draft publishing adapter
- schema markup generator

## Stage 5 — Internal linking and Search Console

- semantic link suggestions
- orphan and depth visualization
- anchor diversity checks
- Google Search Console OAuth integration
- query/page performance ingestion
- change annotations and opportunity scoring

## Stage 6 — Full SearchOps platform

- scheduled monitoring through an external job runner
- team roles and project permissions
- alerts and webhooks
- white-label reports
- multi-site portfolio dashboard
- evaluation suite for AI recommendations
- cost and usage controls

## Definition of done for v1.0

A user can connect a site, crawl it safely at useful scale, combine crawl and Search Console evidence, prioritize issues, generate reviewable fixes and content briefs, track implementation, and demonstrate measurable before/after changes without relying on opaque or manipulative SEO tactics.

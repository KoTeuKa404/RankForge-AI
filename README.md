# RankForge AI

RankForge AI v0.7 beta is a technical SEO and SearchOps application built for ChatGPT Sites and Cloudflare Workers. It crawls public websites, groups and prioritizes findings, stores project history in D1, creates asynchronous audit jobs, saves report artifacts in R2, and generates implementation-ready remediation guidance with Gemini or OpenAI.

## Current beta features

- asynchronous D1-backed audit jobs with `queued`, `running`, `completed`, and `failed` states
- browser polling, progress heartbeat, timeout handling, and up to three manual attempts
- optional JSON report artifacts stored in R2
- bounded same-origin crawler with 5, 10, or 25 page limits
- SSRF protection, redirect validation, response timeouts, and body limits
- robots.txt parsing with specific user-agent groups, Allow/Disallow precedence, and bounded crawl delay
- sitemap.xml and sitemap-index discovery with sitemap URL seeding
- metadata, H1, canonical, noindex, language, content depth, image alt, Open Graph, schema, status, and latency checks
- grouped site-template findings and normalized SEO scoring
- projects, audit history, and regression comparisons in D1
- CSV, JSON, standalone HTML, and stored R2 JSON exports
- keyword clustering and intent classification
- editable content briefs
- internal-link suggestions and orphan-page analysis
- scheduled monitoring configuration and alerts
- AI Fix through Gemini, OpenAI, or automatic provider fallback

## Local setup

Requirements: Node.js 22+.

```cmd
npm install
npm run db:migrate:local
npm run check
npm run dev
```

Open:

- frontend: `http://localhost:5173`
- worker API: `http://127.0.0.1:8787`
- health: `http://127.0.0.1:8787/api/health`

`npm run dev` rebuilds the frontend before starting both local servers. During rapid frontend development, `npm run dev:fast` skips the initial build.

Windows helpers are also included:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-local.ps1
run-local.bat
```

## AI provider configuration

Create an ignored `.dev.vars` file.

Gemini only:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.5-flash
ENVIRONMENT=development
DEV_USER_EMAIL=developer@localhost
```

OpenAI only:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5
ENVIRONMENT=development
DEV_USER_EMAIL=developer@localhost
```

Automatic fallback:

```dotenv
AI_PROVIDER=auto
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.5-flash
```

Secrets must remain server-side and must never be committed.

## Asynchronous audit API

Create a job:

```http
POST /api/audit-jobs
Content-Type: application/json

{
  "url": "https://example.com",
  "maxPages": 25,
  "projectId": null
}
```

Poll it:

```http
GET /api/audit-jobs/{jobId}
```

Retry a failed job with fewer than three attempts:

```http
POST /api/audit-jobs/{jobId}/retry
```

Download the stored R2 JSON report after completion:

```http
GET /api/audit-jobs/{jobId}/report
```

The current beta uses the Worker execution context to finish jobs after returning `202 Accepted`. A future production-scale release should move execution to a durable queue or workflow runner for stronger recovery guarantees.

## Validation

```cmd
npm run build
npm run test
npm run audit:prod
```

Or run all production checks:

```cmd
npm run check
```

A full development-tool audit remains available separately:

```cmd
npm run audit:all
```

## ChatGPT Sites deployment

The repository includes `.openai/hosting.json` with:

- D1 binding: `DB`
- R2 binding: `FILES`

Apply migrations `0001_initial.sql` through `0007_audit_jobs.sql` and configure hosted secrets before publishing.

Recommended first deployment flow:

1. create a private preview;
2. apply all seven D1 migrations;
3. verify `/api/health` reports `asyncAudits: true` and `reportStorage: true`;
4. run one single-page and one 25-page asynchronous crawl;
5. verify progress polling, project persistence, audit comparison, and R2 report download;
6. test AI Fix using the selected provider;
7. test localhost/private-address blocking;
8. publish only after the preview passes.

## Security boundaries

The crawler accepts only public HTTP/HTTPS targets on standard ports. It blocks local/private/reserved literal targets, validates redirect destinations, limits query variants, validates every fetched target, respects applicable robots rules, and restricts crawl depth through a hard page limit.

A future production-scale version should add a dedicated pre-connect DNS resolver and fetch gateway to reject private/reserved DNS answers before each connection.

## Project status

This repository is a working v0.7 beta, not the final v1.0 SearchOps platform. See `ROADMAP.md` for completed and remaining production work.

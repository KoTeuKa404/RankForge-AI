# RankForge AI

RankForge AI is a technical SEO and SearchOps beta built for ChatGPT Sites and Cloudflare Workers. It crawls public websites, groups and prioritizes technical findings, stores project history in D1, and generates implementation-ready remediation guidance with Gemini or OpenAI.

## Current beta features

- bounded same-origin crawler with 5, 10, or 25 page limits
- SSRF protection, redirect validation, response timeouts, and body limits
- robots.txt parsing with specific user-agent groups, Allow/Disallow precedence, and bounded crawl delay
- sitemap.xml and sitemap-index discovery with sitemap URL seeding
- metadata, H1, canonical, noindex, language, content depth, image alt, Open Graph, schema, status, and latency checks
- grouped site-template findings and normalized SEO scoring
- projects, audit history, and regression comparisons in D1
- CSV, JSON, and standalone HTML exports
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
npm run dev
```

Open:

- frontend: `http://localhost:5173`
- worker API: `http://127.0.0.1:8787`
- health: `http://127.0.0.1:8787/api/health`

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

Apply migrations `0001_initial.sql` through `0006_monitoring.sql` and configure hosted secrets before publishing.

Recommended first deployment flow:

1. create a private preview;
2. verify `/api/health`;
3. run one single-page and one 25-page crawl;
4. verify project persistence and audit comparison;
5. test AI Fix using the selected provider;
6. test localhost/private-address blocking;
7. publish only after the preview passes.

## Security boundaries

The crawler accepts only public HTTP/HTTPS targets on standard ports. It blocks local/private/reserved literal targets, validates redirect destinations, limits query variants, validates every fetched target, respects applicable robots rules, and restricts crawl depth through a hard page limit.

A future production-scale version should add a dedicated pre-connect DNS resolver and fetch gateway to reject private/reserved DNS answers before each connection.

## Project status

This repository is a working beta, not the final v1.0 SearchOps platform. See `ROADMAP.md` for completed and remaining production work.

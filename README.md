# RankForge AI

RankForge AI `1.0.0-rc.1` is a technical SEO and SearchOps application for ChatGPT Sites and Cloudflare Workers. It combines a security-bounded crawler, durable audit jobs, Google Search Console evidence, semantic internal-link recommendations, monitoring, content operations, and quality-gated AI remediation.

The repository is a release candidate. Promote it to stable `1.0.0` only after the local and hosted acceptance checks in `PRODUCTION_DEPLOYMENT.md` pass.

## Product capabilities

### Technical SEO crawler

- bounded same-origin crawls with 5, 10, or 25 page limits
- D1-backed asynchronous jobs with `queued`, `running`, `completed`, and `failed` states
- Cloudflare Queue execution with retries, dead-letter queue, and scheduled stale-job recovery
- Worker execution-context fallback when Queue is unavailable
- phase-aware progress, retry UI, audit history, and before/after comparison
- R2 JSON report artifacts plus CSV, JSON, and standalone HTML exports
- robots.txt user-agent groups, Allow/Disallow precedence, bounded crawl delay
- sitemap and sitemap-index discovery with URL seeding
- title, description, H1, canonical, noindex, language, content depth, image-alt, Open Graph, schema, response status, and latency checks
- grouped template findings and normalized scoring

### Security and reliability

- public HTTP/HTTPS targets on standard ports only
- literal private, local, loopback, link-local, reserved, and credential-bearing URL rejection
- A/AAAA DNS-over-HTTPS preflight before every connection and redirect
- redirect destination validation, response timeout, body-size limit, query-variant limit, and final-URL deduplication
- server-side secrets only
- AES-GCM encryption for Google OAuth tokens stored in D1
- monthly audit, AI, Search Console, and crawl-page limits
- production dependency audit, CI, release contracts, and hosted smoke tests

### Search evidence

- Google Search Console OAuth
- automatic token refresh
- property selection
- 7, 28, or 90 day query/page synchronization
- clicks, impressions, CTR, and average-position summaries
- striking-distance, low-CTR, and high-impression opportunity scoring
- saved Search Console snapshots

### SearchOps workflows

- keyword import, deterministic clustering, intent classification, primary keywords, overlap warnings, and content maps
- editable content briefs with workflow states
- internal-link suggestions, orphan pages, anchor ideas, and confidence values
- optional Gemini Embedding 2 semantic enhancement with deterministic fallback
- monitor configurations, scheduled runs, comparisons, and alerts
- Gemini and OpenAI AI Fix with provider fallback
- server-side AI recommendation quality gate that rejects manipulative tactics and unsupported ranking guarantees

## Local setup

Requirements: Node.js 22 or newer.

```cmd
npm install
npm run db:migrate:local
npm run check
npm run dev
```

Open:

- frontend: `http://localhost:5173`
- Worker/API: `http://127.0.0.1:8787`
- health: `http://127.0.0.1:8787/api/health`
- Search Console workspace: `http://localhost:5173/?workspace=search`

Run the local runtime smoke test in another terminal:

```cmd
npm run smoke
```

Windows helpers:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-local.ps1
run-local.bat
```

`npm run dev` rebuilds the frontend before starting Vite and Wrangler. `npm run dev:fast` skips the initial build during rapid frontend work.

## Environment configuration

Copy `.dev.vars.example` to `.dev.vars`. Never commit `.dev.vars`.

Minimum local values:

```dotenv
ENVIRONMENT=development
DEV_USER_EMAIL=developer@localhost
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
MONITOR_TOKEN=replace_with_at_least_32_random_characters
```

OpenAI can be used instead of or alongside Gemini:

```dotenv
AI_PROVIDER=auto
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5
GEMINI_API_KEY=your_gemini_key
```

For Google Search Console local development, create an OAuth Web application, enable the Search Console API, and configure:

```dotenv
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
GSC_TOKEN_SECRET=replace_with_at_least_32_random_characters
GSC_REDIRECT_URI=http://localhost:8787/api/gsc/callback
```

## Validation commands

```cmd
npm run build
npm run test
npm run release:check
npm run audit:prod
```

Run all production checks:

```cmd
npm run check
```

Run the complete local release verification while the Worker is running:

```cmd
npm run release:verify
```

The full development dependency audit remains separate:

```cmd
npm run audit:all
```

## Important API routes

- `POST /api/audit-jobs`
- `GET /api/audit-jobs/{jobId}`
- `POST /api/audit-jobs/{jobId}/retry`
- `GET /api/audit-jobs/{jobId}/report`
- `POST /api/ai-fix`
- `GET /api/usage`
- `GET /api/gsc/status`
- `POST /api/gsc/connect`
- `GET /api/gsc/callback`
- `GET /api/gsc/properties`
- `POST /api/gsc/select-property`
- `POST /api/gsc/sync`
- `GET /api/gsc/snapshots`

## Cloudflare deployment

RankForge uses these bindings:

- D1: `DB`
- R2: `FILES`
- Queue producer: `AUDIT_QUEUE`
- static assets: `ASSETS`

Apply migrations `0001` through `0008`. Create the primary Queue and dead-letter Queue before the first hosted deployment. Full commands, secrets, Google OAuth setup, smoke tests, and the stable promotion procedure are documented in `PRODUCTION_DEPLOYMENT.md`.

## ChatGPT Sites

`.openai/hosting.json` declares D1 and R2. A private Sites preview can use the execution-context fallback when Queue is not exposed by the runtime. Confirm project persistence, crawler safety, AI Fix, report downloads, and Google OAuth against the exact preview hostname before publishing.

## Release status

Current version: `1.0.0-rc.1`.

Stable `1.0.0` requires:

1. a clean `npm install` that synchronizes `package-lock.json`;
2. all migrations applied;
3. `npm run check` passing;
4. local and hosted `npm run smoke` passing;
5. Google Search Console OAuth verified against the deployment hostname;
6. Queue retry/recovery and scheduled monitoring verified;
7. responsive, keyboard, and accessibility review completed.

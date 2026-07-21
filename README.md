# RankForge AI

An AI-driven technical SEO command center designed as a compatible local project for **ChatGPT Sites**. The first release is a real MVP: it crawls up to 25 same-origin HTML pages, produces a prioritized issue backlog and score, stores signed-in users' projects and audits in D1, and generates implementation-ready fixes through the OpenAI Responses API.

## Included in v0.1

- Polished responsive landing page and dashboard
- Same-origin breadth-first crawler with a configurable 5/10/25-page limit
- Manual redirect handling and validation of every redirect target
- SSRF protections for local/private/reserved literal targets and non-standard ports
- Fetch timeouts and 1.5 MB response limits
- Basic robots.txt compliance
- Detection of sitemap.xml
- Technical and on-page checks:
  - status codes
  - titles and descriptions
  - H1 structure
  - canonical validity
  - noindex
  - language declaration
  - thin content
  - missing image alt text
  - Open Graph metadata
  - response latency
  - duplicate titles/descriptions
  - pages without discovered incoming links
- Weighted SEO score and severity filters
- Crawl inventory table
- JSON and standalone HTML report exports
- Optional Sign in with ChatGPT identity support
- D1 projects, audit history, and rate limiting
- AI Fix endpoint using the OpenAI Responses API
- Security headers and conservative error handling
- Unit tests and dependency audit script

## ChatGPT Sites deployment

Sites can link a compatible local source project to managed hosting and stores binding names in `.openai/hosting.json`. This repository requests:

- `DB` — D1 structured storage
- `FILES` — R2 object storage reserved for future report/file features

In ChatGPT Work or Codex, attach/open this project and use:

```text
@Sites Deploy this website project with Sites. Check compatibility and make only the runtime changes required for deployment. Provision durable D1 storage using binding DB and R2 storage using binding FILES. Apply migrations/0001_initial.sql. Keep the public landing page available to signed-out visitors, add optional Sign in with ChatGPT, and keep all authorization checks in server-side code. Save a version for review; do not publish it yet.
```

After reviewing the saved version:

```text
Deploy the approved saved version and report the production URL.
```

Add `OPENAI_API_KEY` in **Sites → More actions → Settings** as a hosted secret. Do not paste it into prompts or commit it. `OPENAI_MODEL` defaults to `gpt-5.6-luna` and can be changed in hosted environment values.

## Local development

Requirements: Node.js 22+.

```bash
npm install
npm run db:migrate:local
npm run dev
```

- frontend: `http://localhost:5173`
- API worker: `http://localhost:8787`

For local OpenAI calls, create `.dev.vars`:

```dotenv
OPENAI_API_KEY=your_local_key
OPENAI_MODEL=gpt-5.6-luna
ENVIRONMENT=development
```

Never commit `.dev.vars` or `.env` files.

## Validation

```bash
npm run check
```

This runs TypeScript validation, production frontend build, unit tests, and a high-severity npm dependency audit.

## Authentication model

Sites forwards authenticated identity to server-side requests using:

- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name` (optional)

The server never trusts client-provided owner identifiers. Saved projects and audits are always scoped by the server-provided email header. Anonymous visitors may run a limited unsaved audit.

## Security notes

The crawler is intentionally bounded, but URL-fetching services remain security-sensitive.

Current safeguards:

- HTTP/HTTPS only
- no embedded URL credentials
- standard ports only
- blocked local/private/reserved literal IP ranges and local host suffixes
- manual redirect validation
- bounded body size, timeout, redirect count, page count, and hourly rate limits
- same-origin crawl queue
- escaped report generation in the client

A production-scale crawler should additionally resolve hostnames through a trusted resolver and reject any private/reserved address returned by DNS before each connection. The generic fetch API in the lightweight runtime does not expose a portable pre-connect DNS pinning interface, so this MVP should not be treated as a high-trust internal-network scanner.

## Architecture

```text
React/Vite UI
      │
      ▼
Web-standard server worker
  ├── safe URL fetch + crawl
  ├── SEO issue engine
  ├── auth boundary
  ├── rate limits
  └── OpenAI Responses API
      │
      ├── D1: users' projects and audit JSON
      └── R2: reserved for later report assets/imports
```


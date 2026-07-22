# RankForge AI 1.0 deployment runbook

This runbook covers a production Cloudflare Workers deployment and a private ChatGPT Sites preview.

## 1. Local release gate

Use Node.js 22 or newer.

```cmd
npm install
npm run db:migrate:local
npm run check
npm run dev
```

In another terminal:

```cmd
npm run smoke
```

The local smoke test expects the Worker at `http://127.0.0.1:8787`.

## 2. Cloudflare resources

Create the database, report bucket, primary queue, and dead-letter queue once:

```cmd
npx wrangler d1 create rankforge-ai
npx wrangler r2 bucket create rankforge-ai-files
npx wrangler queues create rankforge-audit-jobs
npx wrangler queues create rankforge-audit-jobs-dlq
```

Copy the real D1 database ID into `wrangler.jsonc` before deployment. Keep the binding names unchanged:

- D1: `DB`
- R2: `FILES`
- Queue producer: `AUDIT_QUEUE`

## 3. Hosted secrets

Configure at least one AI provider:

```cmd
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
```

Configure monitoring:

```cmd
npx wrangler secret put MONITOR_TOKEN
```

For Google Search Console, enable the Search Console API in the Google Cloud project, create an OAuth Web application, and register this redirect URI:

```text
https://YOUR_DEPLOYED_HOST/api/gsc/callback
```

Then configure:

```cmd
npx wrangler secret put GSC_CLIENT_ID
npx wrangler secret put GSC_CLIENT_SECRET
npx wrangler secret put GSC_TOKEN_SECRET
```

`GSC_TOKEN_SECRET` must contain at least 32 random characters. OAuth access and refresh tokens are encrypted with AES-GCM before being written to D1.

Set the public redirect URI as a Worker variable or hosted environment value:

```text
GSC_REDIRECT_URI=https://YOUR_DEPLOYED_HOST/api/gsc/callback
```

Never put API keys, OAuth client secrets, refresh tokens, or `.dev.vars` in Git.

## 4. Database migrations

Apply all migrations through `0008_search_console_usage.sql`:

```cmd
npm run db:migrate:remote
```

Review the migration list before confirming.

## 5. Deploy

```cmd
npm run deploy:cloudflare
```

The Worker configuration includes:

- Queue consumer with three retries and a dead-letter queue
- scheduled maintenance every five minutes
- stale audit job recovery
- scheduled monitor processing
- monthly safety and cost limits

## 6. Production verification

Set the hosted URL and run:

```cmd
set RANKFORGE_BASE_URL=https://YOUR_DEPLOYED_HOST
npm run smoke
```

`/api/health` should report:

```json
{
  "ok": true,
  "version": "1.0.0-rc.1",
  "database": true,
  "asyncAudits": true,
  "durableQueue": true,
  "reportStorage": true,
  "dnsPreflight": true,
  "aiQualityGate": true
}
```

Search Console is reported as available only after its hosted configuration is complete.

## 7. Acceptance test

Complete each item before releasing `1.0.0`:

1. Create a project and refresh the page; the project remains.
2. Run `https://example.com` with a five-page limit.
3. Run `https://www.web-scraping.dev/products` with a 25-page limit.
4. Confirm Queue progress, completion, audit history, comparison, and R2 report download.
5. Confirm `localhost`, loopback IPs, private IPs, and a hostname resolving to a blocked address are rejected.
6. Generate AI Fix with Gemini and/or OpenAI; verify the provider badge and quality gate.
7. Build a semantic internal-link plan and verify whether semantic enhancement or deterministic fallback is displayed.
8. Connect Google Search Console, select the correct property, synchronize 28 days, and review opportunities.
9. Create and manually run a monitor, then verify an alert and scheduled maintenance.
10. Check responsive layout, keyboard navigation, modal labels, focus visibility, and readable table overflow.
11. Run `npm run check` and `npm run smoke` with no failures.

## 8. ChatGPT Sites private preview

The `.openai/hosting.json` file exposes D1 and R2 bindings. When a Queue binding is unavailable in the Sites runtime, RankForge falls back to the Worker execution context; keep crawls bounded to 25 pages and verify recovery in the private preview.

Configure the same AI and Search Console secrets in the hosted environment. The Google OAuth redirect URI must match the exact preview or production hostname.

Do not publish publicly until project persistence, crawler safety, AI Fix, report download, Search Console OAuth, and mobile layout have passed in the private preview.

## 9. Promote RC to stable

After the acceptance test passes:

1. change `package.json` from `1.0.0-rc.1` to `1.0.0`;
2. run `npm install --package-lock-only`;
3. run `npm run check` and the hosted smoke test;
4. commit the synchronized lockfile and version;
5. create the `v1.0.0` Git tag.

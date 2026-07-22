# ChatGPT Sites compatibility validation

This branch exists only to run the full CI against the Sites-compatible build pipeline.

The build must produce:

- static frontend assets in `dist/`
- the HTTP Worker entry at `dist/server/index.js`
- packaged D1 migrations in `drizzle/`

The Sites runtime uses the HTTP fetch handler and the existing `waitUntil` fallback instead of Queue and cron handlers.

# Local testing on Windows

## First setup

Open PowerShell in the repository directory and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-local.ps1
```

The script:

1. verifies Node.js 22+;
2. installs exactly the versions from `package-lock.json` with `npm ci`;
3. creates an ignored `.dev.vars` from the safe example when needed;
4. applies all local D1 migrations;
5. runs the TypeScript build, production frontend build, unit tests, and dependency audit.

## Start the application

```powershell
.\run-local.bat
```

Open `http://localhost:5173`.

The Vite frontend proxies `/api` to the local Worker on `http://127.0.0.1:8787`.

## Local identity

`DEV_USER_EMAIL` is accepted only when all of these are true:

- `ENVIRONMENT=development`;
- the request hostname is `localhost`, `127.0.0.1`, or `[::1]`;
- no authenticated ChatGPT identity header is present.

This allows projects, histories, briefs, links, and monitoring to be tested locally without weakening production authentication.

## AI Fix

AI Fix is optional. To enable it locally, place your key only in `.dev.vars`:

```dotenv
OPENAI_API_KEY=your_key
```

Never commit `.dev.vars`.

## Monitoring scheduler test

Set a high-entropy `MONITOR_TOKEN` in `.dev.vars`, then call:

```powershell
$token = "the_same_value_from_dev_vars"
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/system/run-monitors" `
  -Headers @{ Authorization = "Bearer $token" }
```

Each call processes at most two due monitors.

## Full validation

```powershell
npm run check
```

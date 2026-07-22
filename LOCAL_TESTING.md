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

## AI Fix providers

AI Fix is optional and supports OpenAI, Gemini, or automatic fallback. Keep all keys only in `.dev.vars` or hosted secrets.

### Gemini only

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.5-flash
```

### OpenAI only

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5
```

### Automatic fallback

```dotenv
AI_PROVIDER=auto
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key
```

In `auto` mode, RankForge tries OpenAI first when both keys exist and falls back to Gemini when the OpenAI request fails. When only one key exists, that provider is used automatically.

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

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22+ is required. Install it and reopen PowerShell."
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
    throw "Node.js 22+ is required. Current version: $(node --version)"
}

if (-not (Test-Path ".dev.vars")) {
    Copy-Item ".dev.vars.example" ".dev.vars"
    Write-Host "Created .dev.vars from the safe example." -ForegroundColor Cyan
}

Write-Host "Installing locked dependencies..." -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

Write-Host "Applying local D1 migrations..." -ForegroundColor Cyan
$previousCi = $env:CI
$env:CI = "1"
try {
    npm run db:migrate:local
    if ($LASTEXITCODE -ne 0) { throw "D1 migration failed." }
} finally {
    $env:CI = $previousCi
}

Write-Host "Running production build, tests, and dependency audit..." -ForegroundColor Cyan
npm run check
if ($LASTEXITCODE -ne 0) { throw "Validation failed." }

Write-Host "Local setup is ready." -ForegroundColor Green
Write-Host "Run .\run-local.bat and open http://localhost:5173" -ForegroundColor Green

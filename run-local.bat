@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required.
  exit /b 1
)

if not exist "node_modules" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local.ps1"
  if errorlevel 1 exit /b 1
)

if not exist ".dev.vars" copy /Y ".dev.vars.example" ".dev.vars" >nul

call npm run dev
endlocal

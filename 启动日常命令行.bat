@echo off
rem Launch the daily planner CLI in a new PowerShell window.
rem Keep this file ASCII-only with CRLF line endings: cmd mis-parses UTF-8 or LF-only batch files.
cd /d "%~dp0"
if not exist "cli\daily.mjs" goto missing

start "daily-planner" powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js not found. Install Node.js 20.19+ or 22.12+ first: https://nodejs.org/' -ForegroundColor Yellow; Read-Host 'Press Enter to close' } else { node 'cli\daily.mjs'; if ($LASTEXITCODE -ne 0) { Write-Host ('daily exited with code ' + $LASTEXITCODE) -ForegroundColor Yellow; Read-Host 'Press Enter to close' } }"

exit /b 0

:missing
echo Cannot find cli\daily.mjs. Please keep this script in the project folder.
pause
exit /b 1

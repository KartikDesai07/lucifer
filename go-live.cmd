@echo off
rem Double-click → take a cafe live. Same as:  node scripts\go-live\index.mjs <client>
rem The client file is clients\<name>.json (copy scripts\go-live\client.example.json
rem or demo.example.json there first). Extra flags pass through: --preview --skip-seed --dry-run --host <label>
rem (node is called directly: `npm run … -- --flag` loses flags from PowerShell on Windows.)
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  set /p CLIENT=Client name (clients\^<name^>.json):
) else (
  set CLIENT=%~1
)
if "%CLIENT%"=="" (
  echo No client named. Nothing done.
  pause
  exit /b 2
)
node scripts\go-live\index.mjs %CLIENT% %2 %3 %4 %5
echo.
pause

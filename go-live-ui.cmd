@echo off
rem Double-click → the owner console at http://127.0.0.1:4848 (opens your browser).
rem All client records live in clients\<slug>.json — gitignored, never uploaded.
setlocal
cd /d "%~dp0"
node scripts\go-live\ui.mjs
pause

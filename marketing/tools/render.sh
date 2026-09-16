#!/usr/bin/env bash
# Render marketing posters to PNG with the desktop app's Electron (local, offline-safe).
# usage: bash marketing/tools/render.sh [poster-name ...]   (default: poster-demo)
# Each name maps marketing/<name>.html -> marketing/out/<name>.png at 2x (2160 x 2700).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/desktop/node_modules/electron/dist/electron.exe"
[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run npm install in apps/desktop first"; exit 1; }
NAMES=("$@"); [ ${#NAMES[@]} -gt 0 ] || NAMES=(poster-demo)
STATUS=0
for NAME in "${NAMES[@]}"; do
  HTML="$ROOT/marketing/$NAME.html"; PNG="$ROOT/marketing/out/$NAME.png"
  [ -f "$HTML" ] || { echo "missing $HTML"; STATUS=1; continue; }
  # ELECTRON_RUN_AS_NODE would turn the binary into plain node; unset it for the render.
  env -u ELECTRON_RUN_AS_NODE "$ELECTRON" --no-sandbox "$ROOT/marketing/tools/render-poster.cjs" "$HTML" "$PNG" 1080 1350 2 || STATUS=1
done
exit $STATUS

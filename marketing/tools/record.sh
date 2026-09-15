#!/usr/bin/env bash
# Record the demo video to MP4 with the desktop app's Electron (local, no uploads).
# usage: bash marketing/tools/record.sh [name=demo-video]   -> marketing/out/<name>.mp4
# First run: (cd marketing/tools && npm install) to fetch the MP4 muxer.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/desktop/node_modules/electron/dist/electron.exe"
NAME="${1:-demo-video}"
[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run npm install in apps/desktop first"; exit 1; }
[ -f "$ROOT/marketing/tools/node_modules/mp4-muxer/build/mp4-muxer.js" ] || { echo "mp4-muxer missing — run: (cd marketing/tools && npm install)"; exit 1; }
mkdir -p "$ROOT/marketing/out"
env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$ROOT/marketing/tools/record-video.cjs" "$ROOT/marketing/$NAME.html" "$ROOT/marketing/out/$NAME.mp4" 1080 1920 30

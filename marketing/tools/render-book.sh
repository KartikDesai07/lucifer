#!/usr/bin/env bash
# Render the brochure: marketing/book.html -> out/book/page-N.png (2x) + out/pos-software-brochure.pdf
# usage: bash marketing/tools/render-book.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/desktop/node_modules/electron/dist/electron.exe"
[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run npm install in apps/desktop first"; exit 1; }
mkdir -p "$ROOT/marketing/out/book"
env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$ROOT/marketing/tools/render-book.cjs" "$ROOT/marketing/book.html" "$ROOT/marketing/out/book" "$ROOT/marketing/out/pos-software-brochure.pdf" 1080 1350 2

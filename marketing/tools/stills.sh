#!/usr/bin/env bash
# Render still frames of the demo video for review: one PNG per time (seconds).
# usage: bash marketing/tools/stills.sh 2.5 8 11 16 23 27 33 40   -> marketing/out/stills/demo-video-<s>s.png
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/desktop/node_modules/electron/dist/electron.exe"
mkdir -p "$ROOT/marketing/out/stills"
STATUS=0
for SEC in "$@"; do
  MS=$(node -e "process.stdout.write(String(Math.round(Number(process.argv[1]) * 1000)))" "$SEC")
  env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$ROOT/marketing/tools/render-poster.cjs" "$ROOT/marketing/demo-video.html" "$ROOT/marketing/out/stills/demo-video-${SEC}s.png" 1080 1920 1 "$MS" 2>&1 | grep -E "^(rendered|render failed)" || STATUS=1
done
exit $STATUS

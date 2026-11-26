#!/usr/bin/env bash
# Contact sheets of every costume the game has (docs/CHARACTER_VIEWER.md, "Costume contact sheets"): each costume drawn standing, its file name under it, 96 to a sheet,
# saved as PNGs in docs/generated/costume_sheets/ (game-derived, so gitignored). Runs the dev page web/costumesheet.html in headless Chrome against the running dev server.
#
#   tools/costume_sheets.sh                  all costumes
#   tools/costume_sheets.sh 'match=^f_'      only costumes whose file name matches (any query of the page: cols, rows, cellw, cellh, turn, match)
#
# Needs: the dev server running with the game found (`OTM_GAME_DIR=<install> npm run dev` in web/; or `local.env`, see local.env.example), and Chrome.
# Environment: DEV_URL (default http://localhost:5173), CHROME (default the macOS app), TIMEOUT seconds (default 1200).
set -euo pipefail

DEV_URL="${DEV_URL:-http://localhost:5173}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TIMEOUT="${TIMEOUT:-1200}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/generated/costume_sheets"
QUERY="${1:-}"

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME)" >&2; exit 1; }
curl -fsS -o /dev/null "$DEV_URL/costumesheet.html" || { echo "No dev server at $DEV_URL (run: OTM_GAME_DIR=<install> npm run dev, in web/)" >&2; exit 1; }

mkdir -p "$OUT"
rm -f "$OUT"/costumes_*.png "$OUT"/costumes_*.txt "$OUT"/done.txt
PROFILE="$(mktemp -d)"
"$CHROME" --headless=new --user-data-dir="$PROFILE" --window-size=1400,900 \
  --use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  "$DEV_URL/costumesheet.html${QUERY:+?$QUERY}" >/dev/null 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$PROFILE" 2>/dev/null || true; }
trap cleanup EXIT

echo "Rendering (this takes a few minutes)..."
waited=0
until [ -f "$OUT/done.txt" ]; do
  sleep 3; waited=$((waited + 3))
  [ "$waited" -lt "$TIMEOUT" ] || { echo "Timed out after ${TIMEOUT}s; sheets so far are in $OUT" >&2; exit 1; }
  n=$(ls "$OUT"/costumes_*.png 2>/dev/null | wc -l | tr -d ' ' || true)
  printf '\r%s sheet(s) done, %ss' "$n" "$waited"
done
echo
cat "$OUT/done.txt"
echo "Sheets: $OUT (costumes_NN.png, with costumes_NN.txt naming each cell, row,column)"

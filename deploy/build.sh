#!/usr/bin/env bash
# Lanzo build + deploy (Next.js standalone).
#
# WHY THIS EXISTS: `next build` in standalone mode regenerates .next/static and
# the custom-server wrapper is NOT auto-copied into .next/standalone. If you only
# copy custom-server.js (or nothing), the standalone server serves 404 for every
# JS chunk -> the dashboard hangs on "Loading..." forever. This script always
# copies BOTH static + custom-server (+ public), so that class of bug can't recur.
#
# Usage:
#   deploy/build.sh              # rebuild + sync + restart + verify
#   deploy/build.sh --no-restart # rebuild + sync only (no systemctl restart)
#   deploy/build.sh --no-build   # skip build, just re-sync artifacts + restart
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="lanzorouter.service"
PORT="${PORT:-1998}"
STANDALONE="${APP_DIR}/.next/standalone"

DO_BUILD=1
DO_RESTART=1
for arg in "$@"; do
  case "$arg" in
    --no-build)   DO_BUILD=0 ;;
    --no-restart) DO_RESTART=0 ;;
  esac
done

cd "$APP_DIR"

if [ "$DO_BUILD" -eq 1 ]; then
  echo "==> Building (ARM-safe: heap-capped + nice/ionice so 9router isn't starved)"
  nice -n 19 ionice -c3 env NODE_OPTIONS="--max-old-space-size=1536" npm run build
fi

echo "==> Syncing standalone artifacts (the step that's easy to forget)"
# 1) custom-server.js — client-IP hardening wrapper, wiped by every build
cp custom-server.js "${STANDALONE}/custom-server.js"
# 2) .next/static — the JS/CSS chunks the HTML references (the 404 culprit)
rm -rf "${STANDALONE}/.next/static"
cp -r .next/static "${STANDALONE}/.next/static"
# 3) public — static assets (logo, favicon, etc.)
if [ -d public ]; then
  mkdir -p "${STANDALONE}/public"
  cp -r public/. "${STANDALONE}/public/"
fi

echo "==> Verify main-app chunk exists on disk"
ls "${STANDALONE}/.next/static/chunks/"main-app-*.js >/dev/null \
  && echo "    OK: main-app chunk present" \
  || { echo "    FAIL: main-app chunk missing after sync"; exit 1; }

if [ "$DO_RESTART" -eq 1 ]; then
  echo "==> Restarting ${SERVICE}"
  sudo systemctl restart "${SERVICE}"
  sleep 6
  systemctl is-active "${SERVICE}"
fi

echo "==> Verify server + one chunk actually serve 200"
BID="$(cat "${STANDALONE}/.next/BUILD_ID")"
CHUNK="$(ls "${STANDALONE}/.next/static/chunks/"main-app-*.js | head -1 | xargs basename)"
H=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "http://localhost:${PORT}/api/health" || echo ERR)
C=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "http://localhost:${PORT}/_next/static/chunks/${CHUNK}" || echo ERR)
echo "    /api/health = ${H}   (expect 200)"
echo "    chunk ${CHUNK} = ${C}   (expect 200)"
[ "$H" = "200" ] && [ "$C" = "200" ] \
  && echo "==> DONE. Build ${BID} deployed & serving." \
  || { echo "==> WARNING: health or chunk not 200 — check journalctl -u ${SERVICE}"; exit 1; }

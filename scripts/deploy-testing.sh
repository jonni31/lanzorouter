#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/home/ubuntu/lanzorouter}
PORT=${PORT:-1998}
PM2_APP=${PM2_APP:-lanzorouter}

cd "$APP_DIR"

echo "== build =="
NEXT_TELEMETRY_DISABLED=1 PORT="$PORT" npm run build

echo "== verify dashboard manifests =="
for route in quota automation mitm; do
  manifest=".next/standalone/.next/server/app/(dashboard)/dashboard/${route}/page_client-reference-manifest.js"
  if [[ ! -f "$manifest" ]]; then
    echo "missing manifest: $manifest" >&2
    exit 1
  fi
  echo "ok: $manifest"
done

echo "== restart pm2 =="
PORT="$PORT" pm2 restart "$PM2_APP" --update-env
sleep 5

echo "== smoke test =="
for path in /login /dashboard/quota /dashboard/automation /dashboard/mitm /dashboard/providers; do
  code=$(curl -s -o /tmp/lanzo-smoke.out -w '%{http_code}' "http://127.0.0.1:${PORT}${path}")
  case "$path:$code" in
    /login:200|/dashboard/*:307)
      echo "ok: $path -> $code"
      ;;
    *)
      echo "unexpected response: $path -> $code" >&2
      head -c 300 /tmp/lanzo-smoke.out >&2 || true
      echo >&2
      exit 1
      ;;
  esac
done

echo "== pm2 error log =="
if [[ -s "/home/ubuntu/.pm2/logs/${PM2_APP}-error.log" ]]; then
  tail -80 "/home/ubuntu/.pm2/logs/${PM2_APP}-error.log"
else
  echo "ok: no errors"
fi

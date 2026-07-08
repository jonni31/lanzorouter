#!/bin/bash
# Deploy lanzorouter to VPS
# Usage: ./deploy.sh [commit_message]

set -e

VPS_HOST="ubuntu@43.156.83.237"
VPS_DIR="/home/ubuntu/lanzorouter"
COMMIT_MSG="${1:-auto deploy}"

echo "=== Deploying to VPS ==="

# 1. Push to GitHub
echo "[1/4] Pushing to GitHub..."
cd /work/repos/lanzorouter
git add -A
git commit -m "$COMMIT_MSG" 2>/dev/null || echo "Nothing to commit"
git push origin master

# 2. Pull on VPS
echo "[2/4] Pulling on VPS..."
ssh $VPS_HOST "cd $VPS_DIR && git pull origin master"

# 3. Build on VPS
echo "[3/5] Building on VPS (this takes ~1-2 min)..."
ssh $VPS_HOST "cd $VPS_DIR && npm run build 2>&1 | tail -5"

# 4. Recreate symlinks (standalone build wipes them)
echo "[4/5] Fixing standalone symlinks..."
ssh $VPS_HOST "cd $VPS_DIR && ln -sfn $VPS_DIR/.next/static $VPS_DIR/.next/standalone/.next/static && ln -sfn $VPS_DIR/public $VPS_DIR/.next/standalone/public && for pkg in playwright playwright-core; do ln -sfn $VPS_DIR/node_modules/\$pkg $VPS_DIR/.next/standalone/node_modules/\$pkg 2>/dev/null; done"

# 5. Restart PM2
echo "[5/5] Restarting PM2..."
ssh $VPS_HOST "cd $VPS_DIR && pm2 restart lanzorouter"

echo ""
echo "=== Deploy complete! ==="
echo "Dashboard: https://baseball-plains-nonprofit-admission.trycloudflare.com"

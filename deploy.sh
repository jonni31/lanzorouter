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
echo "[3/4] Building on VPS (this takes ~1-2 min)..."
ssh $VPS_HOST "cd $VPS_DIR && npm run build 2>&1 | tail -5"

# 4. Restart PM2
echo "[4/4] Restarting PM2..."
ssh $VPS_HOST "cd $VPS_DIR && pm2 restart lanzorouter"

echo ""
echo "=== Deploy complete! ==="
echo "Dashboard: https://baseball-plains-nonprofit-admission.trycloudflare.com"

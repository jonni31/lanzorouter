#!/bin/bash
# Test auto-clean feature

CRON_SECRET=${CRON_SECRET:-"lanzo-cron-secret"}
BASE_URL=${BASE_URL:-"http://localhost:3000"}

echo "=== Testing Auto-Clean Feature ==="

echo "1. Enable auto-clean for xiaomi-mimo..."
curl -X PATCH "$BASE_URL/api/settings" \
  -H "Content-Type: application/json" \
  -d '{"providerAutoClean":{"xiaomi-mimo":true,"cloudflare-ai":true}}' 2>&1 | head -10

echo -e "\n2. Trigger auto-clean manually..."
curl -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/auto-clean" | jq .

echo -e "\n3. Check logs..."
echo "Expected output:"
echo "  - cleaned: N (number of connections deleted)"
echo "  - providers: [list of providers]"
echo "  - total: N"

echo -e "\n=== Test Complete ==="
echo "Verify in UI: deleted connections should be gone"
echo "Dashboard: $BASE_URL/dashboard/providers/xiaomi-mimo"

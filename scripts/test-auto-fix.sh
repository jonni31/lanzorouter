#!/bin/bash
# Test auto-fix errors feature

BASE_URL=${BASE_URL:-"http://localhost:3000"}

echo "=== Testing Auto-Fix Errors Feature ==="

echo "1. Enable auto-fix for cloudflare-ai..."
curl -X PATCH "$BASE_URL/api/settings" \
  -H "Content-Type: application/json" \
  -d '{"providerAutoFix":{"cloudflare-ai":true}}' 2>&1 | head -10

echo -e "\n2. Send requests to trigger rate limit..."
for i in {1..50}; do
  echo "Request $i..."
  curl -s "$BASE_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "@cf/meta/llama-3.1-8b-instruct-fast",
      "messages": [{"role":"user","content":"test"}]
    }' > /dev/null
  sleep 0.1
done

echo -e "\n3. Check logs for AUTO-FIX messages..."
echo "Expected in logs:"
echo "  [AUTO-FIX] ... | Error: rate_limit | Action: wait_and_retry | Retry: true | Wait: 60000ms"

echo -e "\n=== Test Complete ==="
echo "Monitor logs with: tail -f logs/app.log | grep AUTO-FIX"

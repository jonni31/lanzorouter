#!/bin/bash
# Test quota display feature

echo "=== Testing Quota Display ==="

# Test CloudFlare AI
echo "1. Sending request to CloudFlare AI..."
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.1-8b-instruct-fast",
    "messages": [{"role":"user","content":"Hi"}]
  }' 2>&1 | head -20

echo -e "\n✓ Check provider page for quota badge"

# Test MiMo (if you have keys)
echo -e "\n2. Sending request to MiMo..."
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xiaomi-mimo/gpt-4o",
    "messages": [{"role":"user","content":"Hi"}]
  }' 2>&1 | head -20

echo -e "\n✓ Check provider page for balance badge"

echo -e "\n=== Test Complete ==="
echo "Go to: http://localhost:3000/dashboard/providers/cloudflare-ai"
echo "Expected: Quota badge visible on each connection"

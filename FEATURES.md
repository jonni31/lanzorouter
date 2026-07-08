# LanzoRouter New Features

## 1. Quota & Balance Tracking

**Auto-display quota/balance for each connection:**

- **CloudFlare AI:** Rate limit badge `72%` or `1.2K/10K`
- **MiMo/Dashscope:** Balance badge `$0.72` (green if >0, red if =0)
- Updates automatically after each request
- Stored in `providerConnections.data` (quotaLimit, quotaRemaining, balance)

## 2. Auto-Clean Zero Credit

**Automatically delete exhausted connections when enabled.**

### Enable per provider:
1. Go to Provider detail page
2. Toggle "Auto-clean Zero Credit"
3. Deletes connections when balance=0 or quota exhausted

### Cron setup:
```bash
# .env
CRON_SECRET=your-secret-here

# crontab (runs hourly)
0 * * * * curl -H "Authorization: Bearer your-secret-here" http://localhost:3000/api/cron/auto-clean
```

## 3. Auto-Fix Errors

**Intelligent retry with known error patterns.**

### Enable per provider:
1. Go to Provider detail page
2. Toggle "Auto-fix Errors"
3. Automatic retry for rate limits, server errors, timeouts

### Supported patterns:
- Rate limit (429) → wait 60s, retry
- Server error (5xx) → wait 5s, retry
- Network error → wait 2s, retry
- Timeout → retry immediately
- Auth error → skip or refresh token
- Quota exhausted → skip to next

## Configuration

All settings stored in `settings` table:
```json
{
  "providerAutoClean": {
    "cloudflare-ai": true,
    "xiaomi-mimo": true
  },
  "providerAutoFix": {
    "cloudflare-ai": true,
    "xiaomi-mimo": false
  }
}
```

## Testing

### Test quota display:
```bash
# Send request to CloudFlare AI
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct-fast","messages":[{"role":"user","content":"hi"}]}'

# Check provider page - should see quota badge
```

### Test auto-clean:
```bash
# Trigger cron manually
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/auto-clean

# Response shows cleaned connections
```

### Test auto-fix:
```bash
# Enable auto-fix for provider
# Send request that triggers rate limit
# Watch logs for AUTO-FIX messages
```

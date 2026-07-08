/**
 * Parse quota/balance information from provider responses
 * Supports CloudFlare AI rate limits, balance from response body, etc.
 */

/**
 * Parse CloudFlare AI quota from response headers
 * Headers: cf-rate-limit-limit, cf-rate-limit-remaining, cf-rate-limit-reset
 */
function parseCloudflareQuota(headers) {
  const limit = headers.get("cf-rate-limit-limit");
  const remaining = headers.get("cf-rate-limit-remaining");
  const reset = headers.get("cf-rate-limit-reset");

  if (!limit && !remaining) return null;

  return {
    quotaLimit: limit ? parseInt(limit, 10) : null,
    quotaRemaining: remaining ? parseInt(remaining, 10) : null,
    quotaResetAt: reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : null,
    quotaUsed: limit && remaining ? parseInt(limit, 10) - parseInt(remaining, 10) : null,
  };
}

/**
 * Parse generic rate limit headers (x-ratelimit-*)
 */
function parseGenericRateLimit(headers) {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");

  if (!limit && !remaining) return null;

  return {
    quotaLimit: limit ? parseInt(limit, 10) : null,
    quotaRemaining: remaining ? parseInt(remaining, 10) : null,
    quotaResetAt: reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : null,
    quotaUsed: limit && remaining ? parseInt(limit, 10) - parseInt(remaining, 10) : null,
  };
}

/**
 * Parse balance from response body (for providers like MiMo, Dashscope)
 * Expected format: { balance: 0.72 } or { credit: 0.72 } or { remaining_credit: 0.72 }
 */
async function parseBalanceFromBody(response, provider) {
  // Only parse for providers known to return balance in response
  const balanceProviders = ["xiaomi-mimo", "dashscope", "siliconflow"];
  if (!balanceProviders.includes(provider)) return null;

  try {
    // Clone response so we don't consume the original stream
    const clone = response.clone();
    const body = await clone.json();

    const balance = body.balance ?? body.credit ?? body.remaining_credit ?? body.remainingCredit;
    if (typeof balance === "number" && balance >= 0) {
      return { balance, balanceUpdatedAt: new Date().toISOString() };
    }
  } catch {
    // Not JSON or no balance field - that's ok
  }

  return null;
}

/**
 * Main quota parser - tries all strategies based on provider
 */
export async function parseQuota(response, provider) {
  if (!response || !response.headers) return null;

  const headers = response.headers;
  let quota = null;

  // Try CloudFlare-specific headers first
  if (provider === "cloudflare-ai") {
    quota = parseCloudflareQuota(headers);
  }

  // Try generic rate limit headers
  if (!quota) {
    quota = parseGenericRateLimit(headers);
  }

  // Try balance from response body (only for non-streaming JSON responses;
  // parseBalanceFromBody clones the response so the original stream is intact)
  const contentType = headers.get("content-type") || "";
  if (!quota && contentType.includes("json")) {
    const balanceInfo = await parseBalanceFromBody(response, provider);
    if (balanceInfo) {
      quota = { ...quota, ...balanceInfo };
    }
  }

  return quota;
}

/**
 * Format quota for display
 * Returns string like "1.2K/10K" or "72%" or "$0.72"
 */
export function formatQuota(quota) {
  if (!quota) return null;

  // Balance-only display
  if (quota.balance !== undefined && quota.balance !== null) {
    return `$${quota.balance.toFixed(2)}`;
  }

  // Quota limit display
  if (quota.quotaLimit && quota.quotaRemaining !== null) {
    const used = quota.quotaUsed || quota.quotaLimit - quota.quotaRemaining;
    const limit = quota.quotaLimit;

    // Format as percentage if limit is large
    if (limit >= 10000) {
      const percent = Math.round((quota.quotaRemaining / limit) * 100);
      return `${percent}%`;
    }

    // Format as numbers with K/M suffix
    const formatNum = (n) => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
      return n.toString();
    };

    return `${formatNum(quota.quotaRemaining)}/${formatNum(limit)}`;
  }

  return null;
}

/**
 * Check if quota is exhausted (should mark connection unavailable)
 */
export function isQuotaExhausted(quota) {
  if (!quota) return false;

  // Zero balance
  if (quota.balance !== undefined && quota.balance !== null && quota.balance <= 0) {
    return true;
  }

  // Zero remaining requests
  if (quota.quotaRemaining !== undefined && quota.quotaRemaining !== null && quota.quotaRemaining <= 0) {
    return true;
  }

  return false;
}

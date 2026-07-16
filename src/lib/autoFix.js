/**
 * Auto-fix known error patterns
 * When providerAutoFix is enabled:
 *  - Transient errors (rate limit, timeout, server error) → wait and retry
 *  - Auth errors → clear error state and skip to next connection
 *  - Credit/quota errors → NOT handled here (use Auto-clean for that)
 *
 * Auto-fix does NOT disable or delete connections — that's Auto-clean's job.
 */

import { getSettings } from "./db/repos/settingsRepo.js";

/**
 * Detect error pattern and suggest fix
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 * @param {string} provider - Provider ID
 * @returns {object|null} - { type, action, retryable, waitMs }
 */
export function detectErrorPattern(status, error, provider) {
  const errorLower = (error || "").toLowerCase();

  // Request-scoped: context/payload too large — fail the request, do NOT treat as
  // quota/account death (would cascade-burn CF pool when OV sends oversized VLM body).
  if (
    status === 413 ||
    errorLower.includes("context window") ||
    errorLower.includes("context length") ||
    errorLower.includes("estimated number of input") ||
    errorLower.includes("prompt is too long") ||
    errorLower.includes("prompt too long") ||
    errorLower.includes("payload too large") ||
    errorLower.includes("request too large") ||
    errorLower.includes("tokens exceeded this model")
  ) {
    return {
      type: "request_scoped",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Request too large / context window exceeded — fail request, keep account"
    };
  }

  // Rate limit (429 or error message contains "rate limit") — fixable by waiting
  if (status === 429 || errorLower.includes("rate limit") || errorLower.includes("too many requests") || errorLower.includes("high-frequency") || errorLower.includes("non-compliant")) {
    // Check if 429 actually means credits exhausted (not a real rate limit)
    if (errorLower.includes("exhausted") || errorLower.includes("insufficient") || errorLower.includes("quota")) {
      return {
        type: "quota_exhausted",
        action: "skip",
        retryable: false,
        waitMs: 0,
        description: "Credits exhausted — use Auto-clean to handle"
      };
    }
    return {
      type: "rate_limit",
      action: "wait_and_retry",
      retryable: true,
      waitMs: 60000, // 1 minute default
      description: "Rate limit hit, waiting before retry"
    };
  }

  // Server errors (500+) — transient, retry after short wait
  if (status >= 500) {
    return {
      type: "server_error",
      action: "wait_and_retry",
      retryable: true,
      waitMs: 5000,
      description: "Server error, retrying after short wait"
    };
  }

  // Timeout errors — transient, retry immediately
  if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
    return {
      type: "timeout",
      action: "retry",
      retryable: true,
      waitMs: 0,
      description: "Timeout, retrying immediately"
    };
  }

  // Network errors — transient, retry after short wait
  if (errorLower.includes("network") || errorLower.includes("econnrefused") || errorLower.includes("enotfound")) {
    return {
      type: "network_error",
      action: "retry",
      retryable: true,
      waitMs: 2000,
      description: "Network error, retrying after short wait"
    };
  }

  // Quota/credit errors — NOT fixable, skip and let Auto-clean handle
  // Note: bare "exceeded" is intentionally NOT matched here (context-window false positive).
  if (status === 402 || errorLower.includes("quota") ||
      errorLower.includes("exhausted") || errorLower.includes("insufficient") ||
      errorLower.includes("payment required") || errorLower.includes("billing") ||
      errorLower.includes("quota exceeded") || errorLower.includes("credits exceeded")) {
    return {
      type: "quota_exhausted",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Credits exhausted — use Auto-clean to handle"
    };
  }

  // Cloudflare-specific errors (check BEFORE generic 403/auth handling)
  if (errorLower.includes("error code: 1015") || errorLower.includes("cf-error-1015")) {
    return {
      type: "rate_limit",
      action: "wait_and_retry",
      retryable: true,
      waitMs: 120000, // 2 minutes — CF rate limits are aggressive
      description: "Cloudflare rate limit (1015), waiting before retry"
    };
  }
  if (errorLower.includes("error code: 1010") || errorLower.includes("error code: 1020") ||
      errorLower.includes("cf-error-1010") || errorLower.includes("cf-error-1020")) {
    return {
      type: "ip_blocked",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Cloudflare IP block (1010/1020) — need different IP"
    };
  }

  // Auth errors (401, 403) — skip to next connection
  if (status === 401 || status === 403 || errorLower.includes("unauthorized") ||
      errorLower.includes("invalid token") || errorLower.includes("invalid api key") ||
      errorLower.includes("invalid_api_key") || errorLower.includes("forbidden")) {
    // For OAuth providers, token refresh might help
    if ([
      "xiaomi-mimo", "dashscope", "kiro", "antigravity", "gemini-cli",
      "codebuddy", "codebuddy-cn", "qoder", "codex", "claude", "xai",
      "qwen", "iflow", "github"
    ].includes(provider)) {
      return {
        type: "auth_error",
        action: "refresh_token",
        retryable: true,
        waitMs: 0,
        description: "Auth error, refreshing token"
      };
    }
    return {
      type: "auth_error",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Auth error, skipping to next connection"
    };
  }

  // Bad request (400) — client error, not retryable
  if (status === 400 || errorLower.includes("bad request") || errorLower.includes("invalid request")) {
    return {
      type: "bad_request",
      action: "fail",
      retryable: false,
      waitMs: 0,
      description: "Bad request, likely client error"
    };
  }

  return null;
}

/**
 * Check if auto-fix is enabled for a provider
 * @param {string} provider - Provider ID
 * @returns {boolean}
 */
export async function isAutoFixEnabled(provider) {
  const settings = await getSettings();
  return settings.providerAutoFix?.[provider] === true;
}

/**
 * Apply auto-fix for detected error pattern
 * Only retries transient errors. Does NOT disable or delete connections.
 *
 * @param {object} errorPattern - Result from detectErrorPattern
 * @param {object} connection - Provider connection object
 * @param {string} provider - Provider ID
 * @returns {object} - { fixed, shouldRetry, waitMs, action }
 */
export async function applyAutoFix(errorPattern, connection, provider) {
  const autoFixEnabled = await isAutoFixEnabled(provider);
  if (!autoFixEnabled) {
    return {
      fixed: false,
      shouldRetry: false,
      waitMs: 0,
      action: "auto_fix_disabled"
    };
  }

  if (!errorPattern) {
    return {
      fixed: false,
      shouldRetry: false,
      waitMs: 0,
      action: "no_pattern"
    };
  }

  // Transient retryable errors: wait and retry
  if (errorPattern.retryable) {
    switch (errorPattern.action) {
      case "wait_and_retry":
        return {
          fixed: true,
          shouldRetry: true,
          waitMs: errorPattern.waitMs,
          action: "wait_and_retry",
          description: errorPattern.description
        };

      case "retry":
        return {
          fixed: true,
          shouldRetry: true,
          waitMs: errorPattern.waitMs || 0,
          action: "retry",
          description: errorPattern.description
        };

      case "refresh_token":
        console.log(`[AUTO-FIX] Would refresh token for ${connection.connectionId || connection.id}`);
        return {
          fixed: true,
          shouldRetry: true,
          waitMs: 0,
          action: "refresh_token",
          description: "Token refresh triggered"
        };
    }
  }

  // Non-retryable errors (auth, quota) — just skip, don't disable
  return {
    fixed: false,
    shouldRetry: false,
    waitMs: 0,
    action: "skip",
    description: errorPattern.description
  };
}

/**
 * Log auto-fix action
 */
export function logAutoFix(provider, connectionId, errorPattern, fixResult) {
  const timestamp = new Date().toISOString();
  console.log(
    `[AUTO-FIX] ${timestamp} | ${provider} | ${connectionId?.slice(0, 8)} | ` +
    `Error: ${errorPattern?.type || "unknown"} | ` +
    `Action: ${fixResult.action} | ` +
    `Retry: ${fixResult.shouldRetry} | ` +
    `Wait: ${fixResult.waitMs}ms`
  );
}

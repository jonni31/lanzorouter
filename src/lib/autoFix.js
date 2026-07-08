/**
 * Auto-fix known error patterns
 * When providerAutoFix is enabled, automatically retry with fixes
 */

import { getSettings } from "./db/repos/settingsRepo.js";
import { updateProviderConnection } from "./db/repos/connectionsRepo.js";

/**
 * Detect error pattern and suggest fix
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 * @param {string} provider - Provider ID
 * @returns {object|null} - { type, action, retryable, waitMs }
 */
export function detectErrorPattern(status, error, provider) {
  const errorLower = (error || "").toLowerCase();

  // Rate limit (429 or error message contains "rate limit")
  if (status === 429 || errorLower.includes("rate limit") || errorLower.includes("too many requests")) {
    return {
      type: "rate_limit",
      action: "wait_and_retry",
      retryable: true,
      waitMs: 60000, // 1 minute default
      description: "Rate limit hit, wait before retry"
    };
  }

  // Token/Auth errors (401, 403)
  if (status === 401 || status === 403 || errorLower.includes("unauthorized") || errorLower.includes("invalid token")) {
    // For OAuth providers, token refresh might help
    if (provider === "xiaomi-mimo" || provider === "dashscope") {
      return {
        type: "auth_error",
        action: "refresh_token",
        retryable: true,
        waitMs: 0,
        description: "Auth error, refresh token and retry"
      };
    }
    return {
      type: "auth_error",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Auth error, skip to next connection"
    };
  }

  // Quota exhausted
  if (errorLower.includes("quota") || errorLower.includes("exceeded") || errorLower.includes("insufficient")) {
    return {
      type: "quota_exhausted",
      action: "skip",
      retryable: false,
      waitMs: 0,
      description: "Quota exhausted, skip to next connection"
    };
  }

  // Bad request (usually client error, not retryable)
  if (status === 400 || errorLower.includes("bad request") || errorLower.includes("invalid request")) {
    return {
      type: "bad_request",
      action: "fail",
      retryable: false,
      waitMs: 0,
      description: "Bad request, likely client error"
    };
  }

  // Server errors (500+) - retry after short wait
  if (status >= 500) {
    return {
      type: "server_error",
      action: "wait_and_retry",
      retryable: true,
      waitMs: 5000, // 5 seconds
      description: "Server error, wait and retry"
    };
  }

  // Timeout errors
  if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
    return {
      type: "timeout",
      action: "retry",
      retryable: true,
      waitMs: 0,
      description: "Timeout, retry immediately"
    };
  }

  // Network errors
  if (errorLower.includes("network") || errorLower.includes("econnrefused") || errorLower.includes("enotfound")) {
    return {
      type: "network_error",
      action: "retry",
      retryable: true,
      waitMs: 2000,
      description: "Network error, wait and retry"
    };
  }

  // Unknown error - not retryable by default
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
 * @param {object} errorPattern - Result from detectErrorPattern
 * @param {object} connection - Provider connection object
 * @param {string} provider - Provider ID
 * @returns {object} - { fixed, shouldRetry, waitMs, action }
 */
export async function applyAutoFix(errorPattern, connection, provider) {
  if (!errorPattern || !errorPattern.retryable) {
    return {
      fixed: false,
      shouldRetry: false,
      waitMs: 0,
      action: "no_fix_available"
    };
  }

  const autoFixEnabled = await isAutoFixEnabled(provider);
  if (!autoFixEnabled) {
    return {
      fixed: false,
      shouldRetry: false,
      waitMs: 0,
      action: "auto_fix_disabled"
    };
  }

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
      // Token refresh logic would go here
      // For now, just mark as retryable
      console.log(`[AUTO-FIX] Would refresh token for ${connection.id}`);
      return {
        fixed: true,
        shouldRetry: true,
        waitMs: 0,
        action: "refresh_token",
        description: "Token refresh triggered (not implemented)"
      };

    case "skip":
      return {
        fixed: false,
        shouldRetry: false,
        waitMs: 0,
        action: "skip",
        description: errorPattern.description
      };

    default:
      return {
        fixed: false,
        shouldRetry: false,
        waitMs: 0,
        action: "unknown"
      };
  }
}

/**
 * Log auto-fix action
 */
export function logAutoFix(provider, connectionId, errorPattern, fixResult) {
  const timestamp = new Date().toISOString();
  console.log(
    `[AUTO-FIX] ${timestamp} | ${provider} | ${connectionId} | ` +
    `Error: ${errorPattern?.type || "unknown"} | ` +
    `Action: ${fixResult.action} | ` +
    `Retry: ${fixResult.shouldRetry} | ` +
    `Wait: ${fixResult.waitMs}ms`
  );
}

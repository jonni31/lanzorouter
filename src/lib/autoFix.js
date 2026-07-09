/**
 * Auto-fix known error patterns
 * When providerAutoFix is enabled:
 *  - Terminal errors (auth, quota, invalid key) → immediately disable the connection
 *  - Transient errors (rate limit, timeout, server error) → wait and retry
 */

import { getSettings } from "./db/repos/settingsRepo.js";
import { updateProviderConnection } from "./db/repos/connectionsRepo.js";

/**
 * Error patterns that indicate the key/account is permanently broken
 * and should be disabled immediately (not just temporarily locked).
 */
const TERMINAL_ERROR_MARKERS = [
  "invalid api key", "invalid_api_key", "invalid key", "invalid token",
  "token expired", "token invalid", "revoked", "deactivated",
  "unauthorized", "forbidden", "banned", "suspended", "restricted",
  "account disabled", "account deactivated",
  "insufficient_quota", "quota exceeded", "quota exhausted", "credits exhausted",
  "quota is not enough", "payment required", "billing",
  "reached the limit", "limit exceeded",
];

/**
 * Detect error pattern and suggest fix
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 * @param {string} provider - Provider ID
 * @returns {object|null} - { type, action, retryable, terminal, waitMs }
 */
export function detectErrorPattern(status, error, provider) {
  const errorLower = (error || "").toLowerCase();

  // Check for terminal errors first (key/account is dead)
  const isTerminal = TERMINAL_ERROR_MARKERS.some(marker => errorLower.includes(marker));

  // Payment required / quota exhausted (402)
  if (status === 402 || (isTerminal && (errorLower.includes("quota") || errorLower.includes("credit") || errorLower.includes("limit") || errorLower.includes("payment") || errorLower.includes("billing")))) {
    return {
      type: "quota_exhausted",
      action: "disable_connection",
      retryable: false,
      terminal: true,
      waitMs: 0,
      description: "Quota/credits exhausted, disable connection"
    };
  }

  // Auth errors (401, 403) with terminal markers
  if ((status === 401 || status === 403) && isTerminal) {
    // For OAuth providers, token refresh might help first
    if (provider === "xiaomi-mimo" || provider === "dashscope") {
      return {
        type: "auth_error",
        action: "refresh_token",
        retryable: true,
        terminal: false,
        waitMs: 0,
        description: "Auth error, refresh token and retry"
      };
    }
    return {
      type: "auth_error",
      action: "disable_connection",
      retryable: false,
      terminal: true,
      waitMs: 0,
      description: "Auth/key error, disable connection"
    };
  }

  // Rate limit (429 or error message contains "rate limit") - NOT terminal
  if (status === 429 || errorLower.includes("rate limit") || errorLower.includes("too many requests")) {
    // But check if 429 actually means "credits exhausted" (e.g. CodeBuddy sends 429 for exhausted credits)
    if (isTerminal) {
      return {
        type: "quota_exhausted",
        action: "disable_connection",
        retryable: false,
        terminal: true,
        waitMs: 0,
        description: "Credits exhausted (via 429), disable connection"
      };
    }
    return {
      type: "rate_limit",
      action: "wait_and_retry",
      retryable: true,
      terminal: false,
      waitMs: 60000,
      description: "Rate limit hit, wait before retry"
    };
  }

  // Non-terminal auth errors (401/403 without specific terminal markers)
  if (status === 401 || status === 403) {
    if (provider === "xiaomi-mimo" || provider === "dashscope") {
      return {
        type: "auth_error",
        action: "refresh_token",
        retryable: true,
        terminal: false,
        waitMs: 0,
        description: "Auth error, refresh token and retry"
      };
    }
    return {
      type: "auth_error",
      action: "disable_connection",
      retryable: false,
      terminal: true,
      waitMs: 0,
      description: "Auth error, disable connection"
    };
  }

  // Quota errors from error message (without matching status code)
  if (errorLower.includes("quota") || errorLower.includes("exceeded") || errorLower.includes("insufficient") || errorLower.includes("exhausted")) {
    return {
      type: "quota_exhausted",
      action: "disable_connection",
      retryable: false,
      terminal: true,
      waitMs: 0,
      description: "Quota exhausted, disable connection"
    };
  }

  // Bad request (usually client error, not retryable)
  if (status === 400 || errorLower.includes("bad request") || errorLower.includes("invalid request")) {
    return {
      type: "bad_request",
      action: "fail",
      retryable: false,
      terminal: false,
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
      terminal: false,
      waitMs: 5000,
      description: "Server error, wait and retry"
    };
  }

  // Timeout errors
  if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
    return {
      type: "timeout",
      action: "retry",
      retryable: true,
      terminal: false,
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
      terminal: false,
      waitMs: 2000,
      description: "Network error, wait and retry"
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
 * When auto-fix is ON and error is terminal → immediately disable the connection.
 * When auto-fix is OFF → fall through to default markAccountUnavailable behavior.
 *
 * @param {object} errorPattern - Result from detectErrorPattern
 * @param {object} connection - Provider connection object (has connectionId, connectionName)
 * @param {string} provider - Provider ID
 * @returns {object} - { fixed, shouldRetry, disabled, waitMs, action }
 */
export async function applyAutoFix(errorPattern, connection, provider) {
  const autoFixEnabled = await isAutoFixEnabled(provider);
  if (!autoFixEnabled) {
    return {
      fixed: false,
      shouldRetry: false,
      disabled: false,
      waitMs: 0,
      action: "auto_fix_disabled"
    };
  }

  if (!errorPattern) {
    return {
      fixed: false,
      shouldRetry: false,
      disabled: false,
      waitMs: 0,
      action: "no_pattern"
    };
  }

  // Terminal errors: disable the connection immediately
  if (errorPattern.terminal && errorPattern.action === "disable_connection") {
    const connId = connection.connectionId || connection.id;
    const connName = connection.connectionName || connection.name || connId?.slice(0, 8);
    try {
      await updateProviderConnection(connId, {
        isActive: false,
        testStatus: "unavailable",
        autoDisabledAt: new Date().toISOString(),
        autoDisabledReason: errorPattern.type,
      });
      console.log(`[AUTO-FIX] ⛔ Disabled ${provider} connection "${connName}" — ${errorPattern.description}`);
    } catch (err) {
      console.error(`[AUTO-FIX] Failed to disable ${connId}: ${err.message}`);
    }
    return {
      fixed: true,
      shouldRetry: false,
      disabled: true,
      waitMs: 0,
      action: "disabled_connection",
      description: `Disabled "${connName}" — ${errorPattern.description}`
    };
  }

  // Transient retryable errors: wait and retry
  if (errorPattern.retryable) {
    switch (errorPattern.action) {
      case "wait_and_retry":
        return {
          fixed: true,
          shouldRetry: true,
          disabled: false,
          waitMs: errorPattern.waitMs,
          action: "wait_and_retry",
          description: errorPattern.description
        };

      case "retry":
        return {
          fixed: true,
          shouldRetry: true,
          disabled: false,
          waitMs: errorPattern.waitMs || 0,
          action: "retry",
          description: errorPattern.description
        };

      case "refresh_token":
        console.log(`[AUTO-FIX] Would refresh token for ${connection.connectionId || connection.id}`);
        return {
          fixed: true,
          shouldRetry: true,
          disabled: false,
          waitMs: 0,
          action: "refresh_token",
          description: "Token refresh triggered"
        };
    }
  }

  // Non-terminal, non-retryable (e.g. bad_request)
  return {
    fixed: false,
    shouldRetry: false,
    disabled: false,
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
  const disabledTag = fixResult.disabled ? " [DISABLED]" : "";
  console.log(
    `[AUTO-FIX] ${timestamp} | ${provider} | ${connectionId?.slice(0, 8)} | ` +
    `Error: ${errorPattern?.type || "unknown"} | ` +
    `Action: ${fixResult.action}${disabledTag} | ` +
    `Retry: ${fixResult.shouldRetry} | ` +
    `Wait: ${fixResult.waitMs}ms`
  );
}

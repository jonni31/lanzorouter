import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @param {object} options - Optional settings
 * @param {number} options.globalMaxTokensCap - Global cap from settings (0 or falsy = no cap)
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body, options = {}) {
  let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;

  // Auto-increase for tool calling to prevent truncated arguments
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using DEFAULT_MAX_TOKENS
  // which could equal budget_tokens when budget_tokens >= 64000
  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  // Global max tokens cap from settings (applies after all adjustments)
  const globalCap = options.globalMaxTokensCap;
  if (globalCap && typeof globalCap === "number" && globalCap > 0 && maxTokens > globalCap) {
    // Don't cap below thinking budget (would break Claude API)
    if (!body.thinking?.budget_tokens || globalCap > body.thinking.budget_tokens) {
      maxTokens = globalCap;
    }
  }

  return maxTokens;
}


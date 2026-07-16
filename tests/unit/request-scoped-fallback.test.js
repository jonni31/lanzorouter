import { describe, it, expect } from "vitest";
import {
  checkFallbackError,
  isRequestScopedError,
} from "../../open-sse/services/accountFallback.js";

const CF_413_MSG =
  'AiError: Ai: The estimated number of input and maximum output tokens (520498) exceeded this model context window limit (24000).';

describe("request-scoped fallback (413 / context overflow)", () => {
  it("isRequestScopedError: status 413", () => {
    expect(isRequestScopedError(413, "anything")).toBe(true);
  });

  it("isRequestScopedError: CF context-window message without 413 status", () => {
    expect(isRequestScopedError(400, CF_413_MSG)).toBe(true);
  });

  it("checkFallbackError: 413 does NOT burn account / cascade", () => {
    const r = checkFallbackError(413, CF_413_MSG, 0);
    expect(r.shouldFallback).toBe(false);
    expect(r.cooldownMs).toBe(0);
    expect(r.requestScoped).toBe(true);
  });

  it("checkFallbackError: context window text without status still request-scoped", () => {
    const r = checkFallbackError(500, "prompt is too long for this model context window", 0);
    expect(r.shouldFallback).toBe(false);
    expect(r.requestScoped).toBe(true);
  });

  it("checkFallbackError: real 429 still falls back with backoff", () => {
    const r = checkFallbackError(429, "Rate limit exceeded", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
    expect(r.requestScoped).toBeUndefined();
  });

  it("checkFallbackError: 401 still falls back (account issue)", () => {
    const r = checkFallbackError(401, "Invalid API key", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("checkFallbackError: unknown 500 still transient fallback", () => {
    const r = checkFallbackError(500, "Internal server error", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });
});

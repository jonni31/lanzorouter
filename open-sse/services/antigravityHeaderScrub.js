/**
 * Antigravity header scrubbing.
 *
 * Real Antigravity is a Node.js desktop app. Its outbound HTTP requests never
 * include proxy-tracing headers, Stainless SDK headers, or Chromium Sec-Ch-*
 * fingerprint headers. Sending any of these reveals that the request came
 * through a third-party proxy/tool, which Google can use to flag the account.
 *
 * Ported from OmniRoute's antigravityHeaderScrub.ts (mirrors CLIProxyAPI's
 * ScrubProxyAndFingerprintHeaders in misc/header_utils.go).
 */

const HEADERS_TO_REMOVE = new Set([
  // Proxy tracing
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
  "via",
  // Client identity (Stainless SDK — Claude Code specific, not Antigravity)
  "x-title",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-os",
  "x-stainless-arch",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
  "x-stainless-retry-count",
  "x-stainless-helper-method",
  "http-referer",
  "referer",
  // Browser / Chromium fingerprint (Electron clients, NOT Node.js)
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "priority",
  // Drop any incoming Accept-Encoding. We must NOT set it ourselves either:
  // undici (Node fetch) only auto-decompresses the response when the request
  // has no explicit Accept-Encoding. Setting it manually makes undici hand back
  // the raw gzip/br bytes, which then fail JSON.parse ("Invalid JSON response").
  "accept-encoding",
]);

/**
 * Remove headers that reveal proxy infrastructure or a non-native client
 * identity from an outgoing Antigravity upstream request. Returns a new object;
 * the input is not mutated. Authorization is deferred so it serializes last,
 * matching the native Antigravity request fingerprint.
 */
export function scrubProxyAndFingerprintHeaders(headers) {
  const cleaned = {};
  let authorizationValue;
  for (const [key, value] of Object.entries(headers || {})) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("x-zevai-") || HEADERS_TO_REMOVE.has(lowerKey)) {
      continue;
    }
    if (lowerKey === "authorization") {
      authorizationValue = value;
      continue;
    }
    cleaned[key] = value;
  }
  // NOTE: intentionally do NOT set Accept-Encoding — let undici negotiate it and
  // auto-decompress the response. Setting it manually breaks JSON parsing.
  if (authorizationValue !== undefined) {
    cleaned["Authorization"] = authorizationValue;
  }
  return cleaned;
}

export const __HEADERS_SCRUBBED = HEADERS_TO_REMOVE;

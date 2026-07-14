/**
 * Antigravity request identity helpers.
 *
 * Antigravity's real client sends a stable per-account session id, a machine id,
 * a request id, and an "envelope" client tag (antigravity vs jetski). Matching
 * these makes our requests look like the native client instead of a proxy.
 *
 * Ported from OmniRoute's antigravityIdentity.ts (mirrors Antigravity-Manager).
 */

import crypto from "crypto";
import { createRequire } from "module";

// 64-bit FNV-1a constants (as signed int64) — must match Antigravity-Manager's
// session-id derivation so the same email always yields the same session id.
const FNV_OFFSET_I64 = -3750763034362895579n;
const FNV_PRIME_I64 = 1099511628211n;

// One random VS Code session id per process, like a running IDE instance.
const PROCESS_SESSION_ID = crypto.randomUUID();

const nodeRequire = createRequire(import.meta.url);
let systemMachineIdSync = null;
try {
  const mod = nodeRequire("node-machine-id");
  systemMachineIdSync = mod.machineIdSync || mod.default?.machineIdSync || null;
} catch {
  systemMachineIdSync = null;
}

function toNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getProviderDataString(credentials, key) {
  const data = credentials?.providerSpecificData;
  return data && typeof data === "object" ? toNonEmptyString(data[key]) : null;
}

/** Stable key identifying the account (email preferred, then id). */
export function getAntigravityAccountKey(credentials) {
  return (
    toNonEmptyString(credentials?.email) ||
    getProviderDataString(credentials, "email") ||
    getProviderDataString(credentials, "accountId") ||
    toNonEmptyString(credentials?.connectionId) ||
    null
  );
}

/** Non-gmail accounts are treated as enterprise ("jetski" envelope). */
export function isAntigravityEnterpriseAccount(credentials) {
  const email =
    toNonEmptyString(credentials?.email) || getProviderDataString(credentials, "email") || "";
  return !!email && !/@(?:gmail|googlemail)\.com$/i.test(email);
}

/** Envelope client tag the native client sends per account type. */
export function getAntigravityEnvelopeUserAgent(credentials) {
  return isAntigravityEnterpriseAccount(credentials) ? "jetski" : "antigravity";
}

/** Request id: "agent/<epoch-ms>/<hex>" — matches the native client format. */
export function generateAntigravityRequestId() {
  return `agent/${Date.now()}/${crypto.randomBytes(4).toString("hex")}`;
}

/** Random signed-int64-ish session id (used only when no account key exists). */
export function generateAntigravitySessionId() {
  const max = 18446744073709551615n; // 2^64 - 1
  const target = 9_000_000_000_000_000_000n;
  // Rejection sampling to avoid modulo bias.
  const limit = max - (max % target);
  let value;
  do {
    value = crypto.randomBytes(8).readBigUInt64BE();
  } while (value >= limit);
  return `-${(value % target).toString()}`;
}

/** Deterministic session id derived from the account key via 64-bit FNV-1a. */
export function deriveAntigravitySessionId(accountKey) {
  const key = toNonEmptyString(accountKey);
  if (!key) return null;
  let hash = FNV_OFFSET_I64;
  for (const byte of Buffer.from(key, "utf8")) {
    hash = BigInt.asIntN(64, hash ^ BigInt(byte));
    hash = BigInt.asIntN(64, hash * FNV_PRIME_I64);
  }
  return hash.toString();
}

/** Session id for a request: derived-from-account → fallback → random. */
export function getAntigravitySessionId(credentials, fallback) {
  return (
    deriveAntigravitySessionId(getAntigravityAccountKey(credentials)) ||
    toNonEmptyString(fallback) ||
    generateAntigravitySessionId()
  );
}

/** OS machine id, or null (native client omits x-machine-id when unavailable). */
export function deriveAntigravityMachineId() {
  try {
    const id = toNonEmptyString(systemMachineIdSync?.(true));
    if (id) return id;
  } catch {
    // omit header when the OS machine id can't be read
  }
  return null;
}

export function getAntigravityVscodeSessionId() {
  return PROCESS_SESSION_ID;
}

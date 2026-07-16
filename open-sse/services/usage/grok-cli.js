/**
 * Grok CLI / Grok Build usage handler
 *
 * Source of truth: official grok-shell/grok-pager traffic to cli-chat-proxy.grok.com
 *   GET /v1/billing?format=credits
 *   GET /v1/billing
 *   GET /v1/user?include=subscription
 *
 * Observed shapes (protobuf-json style `{ val: number }`):
 *
 * format=credits:
 * {
 *   config: {
 *     currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start, end },
 *     creditUsagePercent: 3.0,
 *     productUsage: [{ product: "GrokBuild", usagePercent: 3.0 }],
 *     onDemandCap: { val },
 *     onDemandUsed: { val },
 *     prepaidBalance: { val },
 *     isUnifiedBillingUser: true,
 *     billingPeriodStart, billingPeriodEnd
 *   }
 * }
 *
 * plain /v1/billing:
 * {
 *   config: {
 *     monthlyLimit: { val: 20000 },
 *     used: { val: 5789 },
 *     onDemandCap: { val: 0 },
 *     billingPeriodStart, billingPeriodEnd,
 *     history: [...]
 *   }
 * }
 *
 * Exhausted free/promo accounts: cap=0/used=0/prepaid=0, no monthlyLimit,
 * no creditUsagePercent → chat 402 spending-limit.
 * Paid/sub accounts usually have creditUsagePercent and/or monthlyLimit even
 * when onDemandCap is 0.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

const USAGE = U("grok-cli");
const BILLING_CREDITS_URL =
  USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const BILLING_MONTHLY_URL =
  USAGE.monthlyUrl || "https://cli-chat-proxy.grok.com/v1/billing";
const USER_URL =
  USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";

/** Unwrap protobuf-json `{ val: n }` or plain numbers/strings. */
function unwrapVal(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function asConfig(billing) {
  if (!billing || typeof billing !== "object") return null;
  const root = billing;
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;
  return config && typeof config === "object" ? config : null;
}

/** Shallow-merge billing configs; later sources fill missing keys only. */
function mergeConfigs(...configs) {
  const out = {};
  for (const cfg of configs) {
    if (!cfg || typeof cfg !== "object") continue;
    for (const [k, v] of Object.entries(cfg)) {
      if (out[k] === undefined || out[k] === null) out[k] = v;
    }
  }
  return out;
}

function buildGrokCliHeaders(accessToken, providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": "grok-pager",
    "x-grok-client-version": "0.2.93",
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

function resolvePlan(user, config) {
  const tier =
    typeof user?.subscriptionTier === "string" ? user.subscriptionTier.trim() : "";
  if (tier) {
    // XPremiumPlus -> X Premium Plus; super_grok -> Super Grok
    return tier
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\s+/g, " ")
      .trim();
  }
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  if (config?.isUnifiedBillingUser === true) return "Grok Build";
  return "Grok Build";
}

function makeQuota({ used, total, resetAt, unlimited = false }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Do NOT set absolute `remaining` — QuotaTable's getRemainingPercentage treats
  // `remaining` as a 0–100 percentage (same trap as Qoder credits).
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

function makePercentQuota({ usedPercent, resetAt, nameHint }) {
  const used = Math.min(100, Math.max(0, toFiniteNumber(usedPercent, 0)));
  return {
    used,
    total: 100,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: resetAt || null,
    unlimited: false,
    unit: "%",
    label: nameHint || null,
  };
}

/**
 * Map billing JSON → normalized quotas object for the dashboard.
 * Accepts either a single billing payload or a pre-merged config-like object.
 * Optional second arg may be a second billing payload (plain monthly) to merge.
 * Returns { quotas, periodEnd, exhausted, plan, rawConfig }.
 */
export function parseGrokCliBilling(billing, userOrSecondBilling = null, maybeUser = null) {
  let user = null;
  let secondBilling = null;

  // Back-compat: parseGrokCliBilling(billing, user)
  // Extended: parseGrokCliBilling(billingCredits, billingMonthly, user)
  if (
    userOrSecondBilling &&
    typeof userOrSecondBilling === "object" &&
    (userOrSecondBilling.config ||
      userOrSecondBilling.monthlyLimit != null ||
      userOrSecondBilling.onDemandCap != null ||
      userOrSecondBilling.creditUsagePercent != null)
  ) {
    secondBilling = userOrSecondBilling;
    user = maybeUser;
  } else {
    user = userOrSecondBilling;
  }

  const primary = asConfig(billing) || {};
  const secondary = asConfig(secondBilling) || {};
  // Prefer credits-window fields from primary, fill monthly fields from secondary.
  const config = mergeConfigs(primary, secondary);
  const root =
    billing && typeof billing === "object" && !Array.isArray(billing) ? billing : {};

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(root.billingPeriodEnd) ||
    parseResetTime(secondary.billingPeriodEnd) ||
    parseResetTime(secondary.currentPeriod?.end) ||
    null;

  const monthlyPeriodEnd =
    parseResetTime(secondary.billingPeriodEnd) ||
    parseResetTime(config.billingPeriodEnd) ||
    periodEnd;

  const weeklyPeriodEnd =
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(primary.billingPeriodEnd) ||
    periodEnd;

  const quotas = {};

  // 1) Weekly / window-window credit usage (format=credits)
  //    creditUsagePercent = how much of the window was used (0–100).
  let creditUsedPercent = toFiniteNumber(config.creditUsagePercent, NaN);
  if (!Number.isFinite(creditUsedPercent) && Array.isArray(config.productUsage)) {
    const grokBuild = config.productUsage.find(
      (p) =>
        p &&
        typeof p === "object" &&
        String(p.product || "")
          .toLowerCase()
          .includes("grokbuild"),
    );
    if (grokBuild) creditUsedPercent = toFiniteNumber(grokBuild.usagePercent, NaN);
    else {
      const first = config.productUsage.find(
        (p) => p && typeof p === "object" && p.usagePercent != null,
      );
      if (first) creditUsedPercent = toFiniteNumber(first.usagePercent, NaN);
    }
  }
  if (Number.isFinite(creditUsedPercent)) {
    const productName =
      Array.isArray(config.productUsage) &&
      config.productUsage.find((p) => p?.product)?.product;
    const label =
      productName && String(productName).trim()
        ? String(productName).trim()
        : "GrokBuild";
    // Key is the bar name shown in UI
    quotas[label] = makePercentQuota({
      usedPercent: creditUsedPercent,
      resetAt: weeklyPeriodEnd,
    });
  }

  // 2) Monthly included allotment (plain /v1/billing)
  const monthlyLimit = unwrapVal(
    config.monthlyLimit ?? secondary.monthlyLimit ?? root.monthlyLimit,
    NaN,
  );
  // plain billing uses `used`; avoid colliding with onDemandUsed
  const monthlyUsed = unwrapVal(
    config.monthlyUsed ??
      secondary.monthlyUsed ??
      (config.monthlyLimit != null || secondary.monthlyLimit != null
        ? (secondary.used ?? config.used)
        : null),
    NaN,
  );
  // If monthlyLimit exists, `used` on plain billing is monthly usage.
  if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
    const used = Number.isFinite(monthlyUsed) ? Math.max(0, monthlyUsed) : 0;
    quotas.Monthly = makeQuota({
      used,
      total: monthlyLimit,
      resetAt: monthlyPeriodEnd,
    });
  }

  // 3) On-demand spending window (only when a real cap is exposed)
  const onDemandCap = unwrapVal(config.onDemandCap ?? root.onDemandCap, NaN);
  const onDemandUsed = unwrapVal(config.onDemandUsed ?? root.onDemandUsed, NaN);
  if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
    const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
    quotas["On-demand"] = makeQuota({
      used,
      total: onDemandCap,
      resetAt: periodEnd,
    });
  }

  // 4) Prepaid top-up balance (remaining credits; no fixed allotment known)
  const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance, NaN);
  if (Number.isFinite(prepaid) && prepaid > 0) {
    quotas.Prepaid = {
      used: 0,
      total: prepaid,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
    };
  }

  // 5) Opportunistic richer credit envelopes (future / other account types)
  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt:
            parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  // 6) Free/promo exhausted fallback:
  //    only when we have ZERO meaningful quota rows and onDemandCap is explicitly 0.
  //    Do NOT paint a fake 0% On-demand bar for subscription accounts that already
  //    exposed GrokBuild % / Monthly / Prepaid.
  const hasMeaningfulQuota = Object.keys(quotas).length > 0;
  if (
    !hasMeaningfulQuota &&
    Number.isFinite(onDemandCap) &&
    onDemandCap === 0
  ) {
    quotas["On-demand"] = {
      used: 1,
      total: 1,
      remainingPercentage: 0,
      resetAt: periodEnd,
      unlimited: false,
    };
  }

  // Exhausted when every finite quota bar is at 0% remaining
  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd,
    exhausted,
    rawConfig: config,
  };
}

/**
 * @param {string} accessToken
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getGrokCliUsage(
  accessToken,
  providerSpecificData = null,
  proxyOptions = null,
) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);

  try {
    // Official CLI polls credits + user; we also pull plain billing for monthlyLimit.
    const [creditsRes, monthlyRes, userRes] = await Promise.all([
      proxyAwareFetch(
        BILLING_CREDITS_URL,
        { method: "GET", headers },
        proxyOptions,
      ),
      proxyAwareFetch(
        BILLING_MONTHLY_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
      proxyAwareFetch(USER_URL, { method: "GET", headers }, proxyOptions).catch(
        () => null,
      ),
    ]);

    if (creditsRes.status === 401 || creditsRes.status === 403) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    if (!creditsRes.ok) {
      const errText = await creditsRes.text().catch(() => "");
      const trimmed = errText ? `: ${errText.slice(0, 200)}` : "";
      return {
        message: `Grok CLI billing API error (${creditsRes.status})${trimmed}`,
      };
    }

    const billingCredits = await creditsRes.json().catch(() => null);
    if (!billingCredits || typeof billingCredits !== "object") {
      return { message: "Grok CLI billing response was not JSON." };
    }

    let billingMonthly = null;
    if (monthlyRes?.ok) {
      billingMonthly = await monthlyRes.json().catch(() => null);
    }

    let user = null;
    if (userRes?.ok) {
      user = await userRes.json().catch(() => null);
    }

    const parsed = parseGrokCliBilling(billingCredits, billingMonthly, user);

    if (!parsed.quotas || Object.keys(parsed.quotas).length === 0) {
      return {
        plan: parsed.plan,
        message:
          "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted — upgrade at https://grok.com/supergrok or add credits at https://grok.com/?_s=usage.",
        quotas: {},
      };
    }

    // Dashboard hides QuotaTable whenever `message` is set, so only attach a
    // message when there are no quota rows to render.
    return {
      plan: parsed.plan,
      quotas: parsed.quotas,
    };
  } catch (error) {
    return { message: `Grok CLI usage error: ${error.message}` };
  }
}

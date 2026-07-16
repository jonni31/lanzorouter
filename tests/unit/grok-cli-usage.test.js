import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseGrokCliBilling } from "../../open-sse/services/usage/grok-cli.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EXHAUSTED_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    billingPeriodStart: "2026-07-08T00:00:00+00:00",
    billingPeriodEnd: "2026-07-15T00:00:00+00:00",
  },
};

const ACTIVE_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    onDemandCap: { val: 100 },
    onDemandUsed: { val: 35 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 12.5 },
    billingPeriodStart: "2026-07-08T00:00:00+00:00",
    billingPeriodEnd: "2026-07-15T00:00:00+00:00",
  },
};

/** Live shape from XPremiumPlus subscription (lanzologan 2026-07-16) */
const SUBSCRIPTION_CREDITS = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-14T04:00:11.065100+00:00",
      end: "2026-07-21T04:00:11.065100+00:00",
    },
    creditUsagePercent: 3.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [{ product: "GrokBuild", usagePercent: 3.0 }],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    billingPeriodStart: "2026-07-14T04:00:11.065100+00:00",
    billingPeriodEnd: "2026-07-21T04:00:11.065100+00:00",
  },
};

const SUBSCRIPTION_MONTHLY = {
  config: {
    monthlyLimit: { val: 20000 },
    used: { val: 5789 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
    history: [],
  },
};

const USER_PROFILE = {
  userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
  email: "user@example.com",
  hasGrokCodeAccess: true,
  subscriptionTier: null,
};

const PREMIUM_USER = {
  userId: "68a07f6c-b5f7-4c8b-8a40-0a3b1f79dc3d",
  email: "lanzologan@gmail.com",
  hasGrokCodeAccess: true,
  subscriptionTier: "XPremiumPlus",
};

describe("grok-cli registry usage flag", () => {
  it("exposes transport.usage urls", () => {
    const cfg = PROVIDERS["grok-cli"];
    expect(cfg.usage?.url).toContain("/v1/billing");
    expect(cfg.usage?.userUrl).toContain("/v1/user");
  });

  it("is listed in USAGE_SUPPORTED_PROVIDERS", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("grok-cli");
  });
});

describe("parseGrokCliBilling", () => {
  it("maps on-demand cap/used + prepaid balance", () => {
    const parsed = parseGrokCliBilling(ACTIVE_BILLING, USER_PROFILE);
    expect(parsed.plan).toBe("Grok Code");
    expect(parsed.quotas["On-demand"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    // Prepaid is remaining-balance style: 0 used of current pot
    expect(parsed.quotas.Prepaid).toMatchObject({
      used: 0,
      total: 12.5,
      remainingPercentage: 100,
    });
    expect(parsed.exhausted).toBe(false);
  });

  it("marks depleted free/promo account as exhausted", () => {
    const parsed = parseGrokCliBilling(EXHAUSTED_BILLING, USER_PROFILE);
    expect(parsed.quotas["On-demand"].remainingPercentage).toBe(0);
    expect(parsed.exhausted).toBe(true);
  });

  it("uses subscriptionTier for plan when present", () => {
    const parsed = parseGrokCliBilling(ACTIVE_BILLING, {
      ...USER_PROFILE,
      subscriptionTier: "super_grok",
    });
    expect(parsed.plan).toBe("Super Grok");
  });

  it("shows GrokBuild % remaining for subscription accounts (not fake 0% on-demand)", () => {
    const parsed = parseGrokCliBilling(
      SUBSCRIPTION_CREDITS,
      SUBSCRIPTION_MONTHLY,
      PREMIUM_USER,
    );
    expect(parsed.plan).toBe("X Premium Plus");
    // Weekly credit window: 3% used → 97% remaining
    expect(parsed.quotas.GrokBuild).toMatchObject({
      used: 3,
      total: 100,
      remainingPercentage: 97,
    });
    // Monthly allotment: 5789 / 20000 used → ~71% remaining
    expect(parsed.quotas.Monthly).toMatchObject({
      used: 5789,
      total: 20000,
    });
    expect(parsed.quotas.Monthly.remainingPercentage).toBeCloseTo(71.055, 1);
    // Must NOT invent a depleted On-demand bar when real meters exist
    expect(parsed.quotas["On-demand"]).toBeUndefined();
    expect(parsed.exhausted).toBe(false);
  });

  it("still works with only credits payload (no monthly)", () => {
    const parsed = parseGrokCliBilling(SUBSCRIPTION_CREDITS, PREMIUM_USER);
    expect(parsed.quotas.GrokBuild.remainingPercentage).toBe(97);
    expect(parsed.quotas["On-demand"]).toBeUndefined();
  });

  it("synthesizes GrokBuild 100% remaining when xAI omits percent fields at 0 usage", () => {
    // Live shape from brand-new XPremiumPlus seats (arisasativa6 / aleandsyrf 2026-07-16):
    // credits payload has weekly window but NO creditUsagePercent / productUsage.
    const ZERO_USAGE_CREDITS = {
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-16T10:05:36.244647+00:00",
          end: "2026-07-23T10:05:36.244647+00:00",
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        isUnifiedBillingUser: true,
        prepaidBalance: { val: 0 },
        billingPeriodStart: "2026-07-16T10:05:36.244647+00:00",
        billingPeriodEnd: "2026-07-23T10:05:36.244647+00:00",
      },
    };
    const ZERO_USAGE_MONTHLY = {
      config: {
        monthlyLimit: { val: 20000 },
        used: { val: 0 },
        onDemandCap: { val: 0 },
        billingPeriodStart: "2026-07-01T00:00:00+00:00",
        billingPeriodEnd: "2026-08-01T00:00:00+00:00",
      },
    };
    const parsed = parseGrokCliBilling(
      ZERO_USAGE_CREDITS,
      ZERO_USAGE_MONTHLY,
      PREMIUM_USER,
    );
    expect(parsed.plan).toBe("X Premium Plus");
    expect(parsed.quotas.GrokBuild).toMatchObject({
      used: 0,
      total: 100,
      remainingPercentage: 100,
    });
    expect(parsed.quotas.Monthly).toMatchObject({
      used: 0,
      total: 20000,
      remainingPercentage: 100,
    });
    expect(parsed.quotas["On-demand"]).toBeUndefined();
    expect(parsed.exhausted).toBe(false);
  });
});

describe("getUsageForProvider(grok-cli)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized quotas from billing + user endpoints", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(ACTIVE_BILLING))
      .mockResolvedValueOnce(jsonResponse({ config: {} })) // monthly
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
      providerSpecificData: {
        email: "user@example.com",
        userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
      },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Grok Code");
    expect(usage.quotas["On-demand"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    expect(usage.quotas.Prepaid).toMatchObject({
      used: 0,
      total: 12.5,
      remainingPercentage: 100,
    });

    // Official CLI fingerprint headers
    const billingCall = proxyAwareFetch.mock.calls[0];
    expect(billingCall[0]).toContain("/v1/billing");
    expect(billingCall[1].headers.Authorization).toBe("Bearer test-token");
    expect(billingCall[1].headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(billingCall[1].headers["x-userid"]).toBe(
      "d84768dd-224d-4052-ba49-0d336fa9160c",
    );
  });

  it("surfaces auth-expired message on 401", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ config: {} }))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "expired",
    });

    expect(usage.message).toMatch(/expired|re-authorize/i);
  });

  it("returns depleted on-demand bar without blocking message when cap is zero", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(EXHAUSTED_BILLING))
      .mockResolvedValueOnce(jsonResponse({ config: {} }))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
    });

    // Dashboard hides QuotaTable when `message` is set — keep message empty
    // so the 0% bar still renders for exhausted free/promo accounts.
    expect(usage.message).toBeUndefined();
    expect(usage.quotas["On-demand"].remainingPercentage).toBe(0);
    expect(usage.quotas["On-demand"].total).toBe(1);
  });

  it("merges credits + monthly for subscription accounts", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SUBSCRIPTION_CREDITS))
      .mockResolvedValueOnce(jsonResponse(SUBSCRIPTION_MONTHLY))
      .mockResolvedValueOnce(jsonResponse(PREMIUM_USER));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
      providerSpecificData: {
        email: "lanzologan@gmail.com",
        userId: "68a07f6c-b5f7-4c8b-8a40-0a3b1f79dc3d",
      },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("X Premium Plus");
    expect(usage.quotas.GrokBuild.remainingPercentage).toBe(97);
    expect(usage.quotas.Monthly).toMatchObject({ used: 5789, total: 20000 });
    expect(usage.quotas["On-demand"]).toBeUndefined();

    // 3 parallel fetches: credits, monthly, user
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(proxyAwareFetch.mock.calls[0][0]).toContain("format=credits");
    expect(String(proxyAwareFetch.mock.calls[1][0])).toMatch(/\/v1\/billing$/);
  });
});

describe("parseQuotaData(grok-cli)", () => {
  it("forwards remainingPercentage for dashboard bars", () => {
    const rows = parseQuotaData("grok-cli", {
      plan: "Grok Code",
      quotas: {
        "On-demand": {
          used: 35,
          total: 100,
          remaining: 65,
          remainingPercentage: 65,
          resetAt: "2026-07-15T00:00:00.000Z",
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "On-demand",
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
  });

  it("forwards GrokBuild + Monthly bars", () => {
    const rows = parseQuotaData("grok-cli", {
      plan: "XPremiumPlus",
      quotas: {
        GrokBuild: {
          used: 3,
          total: 100,
          remainingPercentage: 97,
          resetAt: "2026-07-21T04:00:11.065Z",
        },
        Monthly: {
          used: 5789,
          total: 20000,
          remainingPercentage: 71.055,
          resetAt: "2026-08-01T00:00:00.000Z",
        },
      },
    });
    expect(rows.map((r) => r.name).sort()).toEqual(["GrokBuild", "Monthly"]);
    expect(rows.find((r) => r.name === "GrokBuild").remainingPercentage).toBe(97);
  });
});

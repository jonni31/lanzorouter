/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { CLIENT_METADATA, getPlatformUserAgent } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// GitHub API config
const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

// GLM quota endpoints (region-aware)
const GLM_QUOTA_URLS = {
  international: "https://api.z.ai/api/monitor/usage/quota/limit",
  china: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
};

// MiniMax usage endpoints (try in order, fallback on transient errors)
const MINIMAX_USAGE_URLS = {
  minimax: [
    "https://www.minimax.io/v1/token_plan/remains",
    "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  ],
  "minimax-cn": [
    "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
  ],
};

// Antigravity API config (from Quotio)
const ANTIGRAVITY_CONFIG = {
  // Multiple upstream domains — Google routes free/paid accounts differently and
  // some hosts 403 where others 200. Try in order until one answers (ported from
  // OmniRoute antigravityUpstream.ts).
  quotaApiHosts: [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
  ],
  fetchAvailableModelsPath: "/v1internal:fetchAvailableModels",
  retrieveUserQuotaPath: "/v1internal:retrieveUserQuota",
  loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "",
  userAgent: getPlatformUserAgent(),
};

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};

// Claude API config
const CLAUDE_CONFIG = {
  oauthUsageUrl: "https://api.anthropic.com/api/oauth/usage",
  usageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
  settingsUrl: "https://api.anthropic.com/v1/settings",
  apiVersion: "2023-06-01",
};

const CODEBUDDY_CONFIG = {
  usageUrlPath: "/v2/billing/meter/get-user-resource",
  productCode: "p_tcaca",
  packageCodes: {
    free: "TCACA_code_001_PqouKr6QWV",
    proMon: "TCACA_code_002_AkiJS3ZHF5",
    gift: "TCACA_code_006_DbXS0lrypC",
    activity: "TCACA_code_007_nzdH5h4Nl0",
    proYear: "TCACA_code_003_FAnt7lcmRT",
    freeMon: "TCACA_code_008_cfWoLwvjU4",
    extra: "TCACA_code_009_0XmEQc2xOf",
  },
};

// Build the billing/meter endpoint for the given provider-specific data.
// Global edition uses www.codebuddy.ai; the China edition (codebuddy-cn)
// is served from www.codebuddy.cn. The stored domain takes precedence;
// otherwise the provider id determines the default domain.
function getCodeBuddyUsageUrl(providerSpecificData = {}, provider = "codebuddy") {
  const defaultDomain = provider === "codebuddy-cn" ? "www.codebuddy.cn" : "www.codebuddy.ai";
  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || defaultDomain;
  return `https://${domain}${CODEBUDDY_CONFIG.usageUrlPath}`;
}

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken, providerSpecificData, proxyOptions);
    case "gemini-cli":
      return await getGeminiUsage(accessToken, providerDataWithProjectId, proxyOptions);
    case "antigravity":
      return await getAntigravityUsage(accessToken, providerDataWithProjectId, proxyOptions);
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(accessToken, providerSpecificData, proxyOptions);
    case "codebuddy":
    case "codebuddy-cn":
      return await getCodeBuddyUsage(accessToken, providerSpecificData, proxyOptions, apiKey, provider);
    case "qoder":
      return await getQoderUsage(accessToken, proxyOptions);
    case "autoclaw":
      return await getAutoclawUsage(accessToken, proxyOptions, connection);
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken);
    case "glm":
    case "glm-cn":
      return await getGlmUsage(apiKey, provider, proxyOptions);
    case "minimax":
    case "minimax-cn":
      return await getMiniMaxUsage(apiKey, provider, proxyOptions);
    case "deepseek":
      return await getDeepSeekUsage(apiKey, proxyOptions);
    case "openrouter":
      return await getOpenRouterUsage(apiKey, proxyOptions);
    case "openai":
      return await getOpenAIUsage(apiKey, proxyOptions);
    case "anthropic":
      return await getAnthropicUsage(apiKey, proxyOptions);
    case "mistral":
      return await getMistralUsage(apiKey, proxyOptions);
    case "together":
      return await getTogetherUsage(apiKey, proxyOptions);
    case "fireworks":
      return await getFireworksUsage(apiKey, proxyOptions);
    case "groq":
      return await getGroqUsage(apiKey, proxyOptions);
    case "cohere":
      return await getCohereUsage(apiKey, proxyOptions);
    case "elevenlabs":
      return await getElevenLabsUsage(apiKey, proxyOptions);
    case "deepgram":
      return await getDeepgramUsage(apiKey, proxyOptions);
    case "gemini":
      return { plan: "Gemini (API Key)", message: "Gemini API key plans use Google Cloud billing. Check usage at console.cloud.google.com or aistudio.google.com." };
    case "perplexity":
      return { plan: "Perplexity", message: "Perplexity billing available at perplexity.ai/settings. No public balance API." };
    case "nebius":
      return { plan: "Nebius AI", message: "Nebius billing available at studio.nebius.com. No public balance API." };
    case "sambanova":
      return { plan: "SambaNova", message: "SambaNova free tier — no balance API. Check usage at cloud.sambanova.ai." };
    case "cerebras":
      return { plan: "Cerebras", message: "Cerebras free tier — no balance API. Check usage at cloud.cerebras.ai." };
    case "hyperbolic":
      return await getHyperbolicUsage(apiKey, proxyOptions);
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

async function fetchCodeBuddyUid(accessToken, providerSpecificData = {}, proxyOptions = null, provider = "codebuddy") {
  const cachedUid = providerSpecificData?.uid || providerSpecificData?.rawAuth?.uid;
  if (cachedUid) return { uid: cachedUid, enterpriseId: providerSpecificData?.enterpriseId || null };

  const defaultDomain = provider === "codebuddy-cn" ? "www.codebuddy.cn" : "www.codebuddy.ai";
  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || defaultDomain;
  try {
    const response = await proxyAwareFetch(`https://${domain}/v2/plugin/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Domain": domain,
      },
    }, proxyOptions);

    if (!response.ok) return { uid: null, enterpriseId: null };

    const body = await response.json();
    const accounts = body?.data?.accounts || [];
    const account = accounts.find((a) => a.lastLogin) || accounts[0] || {};
    return {
      uid: account.uid || null,
      enterpriseId: account.enterpriseId || null,
    };
  } catch {
    return { uid: null, enterpriseId: null };
  }
}

async function getCodeBuddyUsage(accessToken, providerSpecificData = {}, proxyOptions = null, apiKey = null, provider = "codebuddy") {
  // Prefer the IDE OAuth token; fall back to the API key (chat key) when no
  // OAuth token is stored. The billing/meter endpoint on both the global (.ai)
  // and China (.cn) editions accepts the API key via Authorization: Bearer +
  // X-Api-Key, so even lanzorouter-generated chat keys are tried. If the
  // endpoint rejects the key (401/403) we fall back to the local-router
  // tracking message instead of throwing.
  const isGeneratedKey = providerSpecificData?.authMode === "generated-api-key";
  const effectiveToken = accessToken || apiKey;
  const authMode = accessToken ? "oauth" : apiKey ? "api-key" : null;

  if (!effectiveToken) {
    return {
      plan: "CodeBuddy",
      message: "CodeBuddy upstream quota is unavailable because no valid IDE OAuth token or API key is stored.",
      quotas: {},
      trackingMode: "unavailable",
    };
  }

  // Local-router fallback message used when an API-key (chat key) connection
  // cannot read upstream quota — e.g. a generated key the upstream rejects.
  const chatKeyFallback = {
    plan: "CodeBuddy",
    message: "CodeBuddy chat key active. Upstream quota is unavailable without a valid IDE OAuth token; use LanzoRouter Usage for local request and token tracking.",
    quotas: {},
    authMode: isGeneratedKey ? "generated-api-key" : "api-key",
    trackingMode: "local-router",
  };

  try {
    const { uid, enterpriseId } = await fetchCodeBuddyUid(effectiveToken, providerSpecificData, proxyOptions, provider);

    const response = await proxyAwareFetch(getCodeBuddyUsageUrl(providerSpecificData, provider), {
      method: "POST",
      headers: buildCodeBuddyUsageHeaders(effectiveToken, providerSpecificData, uid, enterpriseId, apiKey),
      body: JSON.stringify(buildCodeBuddyUsageBody()),
    }, proxyOptions);

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (response.status === 401 || response.status === 403) {
      // OAuth token rejected — surface explicitly (callers may force-refresh & retry).
      if (authMode === "oauth") {
        return {
          plan: "CodeBuddy",
          message: `CodeBuddy IDE OAuth token was rejected (${response.status}). Upstream quota is unavailable; use LanzoRouter Usage for local request and token tracking.`,
          quotas: {},
          authMode: "oauth-rejected",
          trackingMode: "local-router",
        };
      }
      // API key (chat key) rejected — fall back to local-router tracking.
      return chatKeyFallback;
    }

    if (!response.ok) {
      return {
        plan: "CodeBuddy",
        message: `CodeBuddy quota endpoint returned ${response.status}.`,
        quotas: {},
      };
    }

    return {
      ...parseCodeBuddyUsage(payload),
      authMode,
    };
  } catch (error) {
    return { plan: "CodeBuddy", message: `CodeBuddy connected. Unable to fetch quota: ${error.message}`, quotas: {} };
  }
}

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

function formatCodeBuddyDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildCodeBuddyUsageBody() {
  const now = new Date();
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 101);

  return {
    PageNumber: 1,
    PageSize: 200,
    ProductCode: CODEBUDDY_CONFIG.productCode,
    Status: [0, 3],
    PackageCodes: Object.values(CODEBUDDY_CONFIG.packageCodes),
    PackageEndTimeRangeBegin: formatCodeBuddyDate(now),
    PackageEndTimeRangeEnd: formatCodeBuddyDate(rangeEnd),
  };
}

function buildCodeBuddyUsageHeaders(accessToken, providerSpecificData = {}, uid = null, enterpriseId = null, apiKey = null) {
  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || "www.codebuddy.ai";

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Content-Type": "application/json",
    "X-Domain": domain,
  };

  // When authenticating with an API key (chat key) instead of an IDE OAuth
  // token, also send the key via X-Api-Key — the billing/meter endpoint on
  // both the global (.ai) and China (.cn) editions accepts this header.
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  if (uid) {
    headers["X-User-Id"] = uid;
  }
  if (enterpriseId) {
    headers["X-Enterprise-Id"] = enterpriseId;
    headers["X-Tenant-Id"] = enterpriseId;
  }

  return headers;
}

function parseCodeBuddyUsage(payload) {
  const data = payload?.data?.Response?.Data || payload?.Response?.Data || payload?.data || payload || {};
  const accounts = Array.isArray(data?.Accounts)
    ? data.Accounts
    : Array.isArray(data?.accounts)
      ? data.accounts
      : [];

  if (accounts.length === 0) {
    return {
      plan: "CodeBuddy",
      message: "CodeBuddy connected. No quota records were returned.",
      quotas: {},
    };
  }

  const quotas = {};
  let hasProPackage = false;

  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const label = getCodeBuddyQuotaLabel(account.PackageCode);
    if (!label) continue;

    if (account.PackageCode === CODEBUDDY_CONFIG.packageCodes.proMon || account.PackageCode === CODEBUDDY_CONFIG.packageCodes.proYear) {
      hasProPackage = true;
    }

    const quota = getCodeBuddyQuotaValues(account);
    if (!quota) continue;

    if (!quotas[label]) {
      quotas[label] = {
        used: 0,
        total: 0,
        remaining: 0,
        resetAt: null,
        unit: "credits",
        unlimited: false,
      };
    }

    quotas[label].used += quota.used;
    quotas[label].total += quota.total;
    quotas[label].remaining += quota.remaining;
    quotas[label].resetAt = getEarlierReset(quotas[label].resetAt, quota.resetAt);
  }

  if (Object.keys(quotas).length === 0) {
    return {
      plan: hasProPackage ? "Pro" : "Free",
      message: "CodeBuddy connected. Unable to extract quota values.",
      quotas: {},
    };
  }

  for (const quota of Object.values(quotas)) {
    quota.remainingPercentage = quota.total > 0
      ? Math.max(0, Math.min(100, (quota.remaining / quota.total) * 100))
      : 0;
  }

  return {
    plan: hasProPackage ? "Pro" : "Free",
    quotas,
  };
}

function getCodeBuddyQuotaLabel(packageCode) {
  const codes = CODEBUDDY_CONFIG.packageCodes;
  switch (packageCode) {
    case codes.free:
    case codes.freeMon:
    case codes.proMon:
    case codes.proYear:
      return "Monthly Credits";
    case codes.gift:
      return "Gift Credits";
    case codes.extra:
      return "Extra Credits";
    case codes.activity:
      return "Activity Credits";
    default:
      return packageCode ? "Other Credits" : null;
  }
}

function getCodeBuddyQuotaValues(account) {
  const total = firstFiniteNumber(
    account.CycleCapacitySizePrecise,
    account.CycleCapacitySize,
    account.CapacitySizePrecise,
    account.CapacitySize,
  );
  const remaining = firstFiniteNumber(
    account.CycleCapacityRemainPrecise,
    account.CapacityRemainPrecise,
    account.CapacityRemain,
  );
  const used = firstFiniteNumber(
    account.CapacityUsedPrecise,
    account.CapacityUsed,
    total !== null && remaining !== null ? Math.max(0, total - remaining) : null,
  );

  if (total === null && remaining === null && used === null) return null;

  const safeTotal = Math.max(0, total ?? ((used ?? 0) + (remaining ?? 0)));
  const safeRemaining = Math.max(0, remaining ?? Math.max(0, safeTotal - (used ?? 0)));
  const safeUsed = Math.max(0, used ?? Math.max(0, safeTotal - safeRemaining));

  return {
    total: safeTotal,
    remaining: safeRemaining,
    used: safeUsed,
    resetAt: parseResetTime(account.CycleEndTime || account.DeductionEndTime || account.ExpiredTime),
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function getEarlierReset(current, next) {
  if (!current) return next || null;
  if (!next) return current;
  return new Date(next).getTime() < new Date(current).getTime() ? next : current;
}

/**
 * GitHub Copilot Usage
 * Uses GitHub accessToken (not copilotToken) to call copilot_internal/user API
 */
async function getGitHubUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    if (!accessToken) {
      throw new Error("No GitHub access token available. Please re-authorize the connection.");
    }

    // copilot_internal/user API requires GitHub OAuth token, not copilotToken
    const response = await proxyAwareFetch("https://api.github.com/copilot_internal/user", {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
        "Editor-Version": "vscode/1.100.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    }, proxyOptions);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = await response.json();

    // Handle different response formats (paid vs free)
    if (data.quota_snapshots) {
      // Paid plan format
      const snapshots = data.quota_snapshots;
      const resetAt = parseResetTime(data.quota_reset_date);

      return {
        plan: data.copilot_plan,
        resetDate: data.quota_reset_date,
        quotas: {
          chat: { ...formatGitHubQuotaSnapshot(snapshots.chat), resetAt },
          completions: { ...formatGitHubQuotaSnapshot(snapshots.completions), resetAt },
          premium_interactions: { ...formatGitHubQuotaSnapshot(snapshots.premium_interactions), resetAt },
        },
      };
    } else if (data.monthly_quotas || data.limited_user_quotas) {
      // Free/limited plan format
      const monthlyQuotas = data.monthly_quotas || {};
      const usedQuotas = data.limited_user_quotas || {};
      const resetAt = parseResetTime(data.limited_user_reset_date);

      return {
        plan: data.copilot_plan || data.access_type_sku,
        resetDate: data.limited_user_reset_date,
        quotas: {
          chat: {
            used: usedQuotas.chat || 0,
            total: monthlyQuotas.chat || 0,
            unlimited: false,
            resetAt,
          },
          completions: {
            used: usedQuotas.completions || 0,
            total: monthlyQuotas.completions || 0,
            unlimited: false,
            resetAt,
          },
        },
      };
    }

    return { message: "GitHub Copilot connected. Unable to parse quota data." };
  } catch (error) {
    throw new Error(`Failed to fetch GitHub usage: ${error.message}`);
  }
}

function formatGitHubQuotaSnapshot(quota) {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}

/**
 * Gemini CLI Usage \u2014 fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await proxyAwareFetch(
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ project: projectId }),
          signal: controller.signal,
        },
        proxyOptions
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (project && typeof project === "object" && typeof project.id === "string") {
    return project.id.trim() || null;
  }
  return null;
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await proxyAwareFetch(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: CLIENT_METADATA,
        }),
        signal: controller.signal,
      },
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST to the first Antigravity host that answers (2xx/401/403). Returns
 * { response, host } or throws if every host is unreachable.
 */
async function antigravityQuotaFetch(path, accessToken, bodyObj, proxyOptions) {
  let lastError = null;
  for (const host of ANTIGRAVITY_CONFIG.quotaApiHosts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await proxyAwareFetch(`${host}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "x-request-source": "local", // MITM bypass
        },
        body: JSON.stringify(bodyObj || {}),
        signal: controller.signal,
      }, proxyOptions);
      // A definitive answer (ok, or auth/permission verdict) ends the loop; only
      // transient upstream errors (5xx / network) fall through to the next host.
      if (response.ok || response.status === 401 || response.status === 403) {
        return { response, host };
      }
      lastError = new Error(`Antigravity API error: ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  if (lastError) throw lastError;
  throw new Error("Antigravity API unavailable");
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API.
 *
 * Two upstream sources are merged:
 *   - fetchAvailableModels: catalog + per-model quotaInfo (can be stale/full).
 *   - retrieveUserQuota:    per-model consumption buckets (source of truth).
 * retrieveUserQuota wins when it reports a model, matching OmniRoute behaviour.
 */
async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Prefer the projectId stored on the connection; fall back to loadCodeAssist.
    const savedProjectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let subscriptionInfo = null;
    let projectId = savedProjectId;
    if (!projectId) {
      subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subscriptionInfo?.cloudaicompanionProject);
    }

    // fetchAvailableModels (catalog) \u2014 required. retrieveUserQuota (live) \u2014 best effort.
    let modelsResp;
    try {
      modelsResp = await antigravityQuotaFetch(
        ANTIGRAVITY_CONFIG.fetchAvailableModelsPath,
        accessToken,
        projectId ? { project: projectId } : {},
        proxyOptions
      );
    } catch (error) {
      return { message: `Antigravity quota unavailable: ${error.message}. Chat may still work.` };
    }

    const response = modelsResp.response;

    if (response.status === 401) {
      // Distinguish a dead account (refresh token revoked/deleted) from a merely
      // stale access token, so the dashboard can tell the user which is which.
      const deadReason = await getAntigravityAccountDeadReason(providerSpecificData, proxyOptions);
      if (deadReason) {
        return { accountDead: true, message: `Antigravity account ${deadReason}. Reconnect won't help \u2014 recreate the account.`, quotas: {} };
      }
      return { message: "Antigravity quota API authentication expired. Chat may still work.", quotas: {} };
    }

    if (response.status === 403) {
      return { message: "Antigravity quota API access forbidden (tier may not expose quota). Chat may still work.", quotas: {} };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();

    // Live consumption buckets keyed by modelId (source of truth).
    // retrieveUserQuota works with or without a project — send the project when
    // we have one, otherwise an empty body (Google resolves the default project).
    const liveBuckets = new Map();
    try {
      const quotaResp = await antigravityQuotaFetch(
        ANTIGRAVITY_CONFIG.retrieveUserQuotaPath,
        accessToken,
        projectId ? { project: projectId } : {},
        proxyOptions
      );
      if (quotaResp.response.ok) {
        const quotaData = await quotaResp.response.json();
        if (Array.isArray(quotaData.buckets)) {
          for (const bucket of quotaData.buckets) {
            const id = String(bucket.modelId || "").trim();
            if (id) liveBuckets.set(id, bucket);
          }
        }
      }
    } catch {
      // Non-fatal: fall back to catalog-only quotaInfo.
    }

    const quotas = {};
    if (data.models) {
      const importantModels = [
        'gemini-3-flash-agent',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        'gemini-3-flash',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        if (info.isInternal || !importantModels.includes(modelKey)) continue;

        // retrieveUserQuota bucket wins over the (possibly stale) catalog quotaInfo.
        const live = liveBuckets.get(modelKey);
        const quotaSource = live || info.quotaInfo;
        if (!quotaSource) continue;

        const remainingFraction = Number(quotaSource.remainingFraction) || 0;
        const remainingPercentage = remainingFraction * 100;
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(quotaSource.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
          quotaSource: live ? "retrieveUserQuota" : "fetchAvailableModels",
        };
      }
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Probe whether an Antigravity account is permanently dead (refresh token
 * revoked / account deleted). Returns a short reason string, or null if the
 * account looks alive (or we can't tell). Used to turn a misleading
 * "authentication expired" into an actionable "account deleted" verdict.
 */
async function getAntigravityAccountDeadReason(providerSpecificData, proxyOptions = null) {
  const refreshToken = providerSpecificData?.refreshToken;
  if (!refreshToken) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CONFIG.clientId,
          client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        signal: controller.signal,
      }, proxyOptions);
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.ok) return null; // refresh works \u2192 account alive, token just stale
    const body = await response.json().catch(() => ({}));
    if (body.error === "invalid_grant") {
      const desc = (body.error_description || "").toLowerCase();
      if (desc.includes("deleted")) return "has been deleted";
      if (desc.includes("disabled") || desc.includes("suspend")) return "is disabled/suspended";
      return "authorization was revoked";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get Antigravity project ID from subscription info
 */
async function getAntigravityProjectId(accessToken) {
  try {
    const info = await getAntigravitySubscriptionInfo(accessToken);
    return info?.cloudaicompanionProject || null;
  } catch {
    return null;
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "x-request-source": "local", // MITM bypass
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
      signal: controller.signal,
    }, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Claude Usage - Primary: OAuth endpoint, Fallback: legacy settings/org endpoint
 */
async function getClaudeUsage(accessToken, proxyOptions = null) {
  try {
    // Primary: OAuth usage endpoint (Claude Code consumer OAuth tokens)
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      // utilization = % USED (e.g. 87 means 87% used, 13% remaining)
      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      // Parse model-specific weekly windows (e.g. seven_day_sonnet, seven_day_opus)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas,
      };
    }

    // Fallback: legacy settings + org usage endpoint
    console.warn(`[Claude Usage] OAuth endpoint returned ${oauthResponse.status}, falling back to legacy`);
    return await getClaudeUsageLegacy(accessToken, proxyOptions);
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

/**
 * Legacy Claude usage for API key / org admin users
 */
async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

/**
 * Codex (OpenAI) Usage - Fetch from ChatGPT backend API
 */
function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getCodexRateLimitBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot.rate_limit && typeof snapshot.rate_limit === "object"
    ? snapshot.rate_limit
    : snapshot;
}

function formatCodexWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.used_percent ?? window?.percent_used, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas, prefix, snapshot) {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const primary = rateLimit.primary_window || rateLimit.primary || snapshot.primary_window || snapshot.primary;
  const secondary = rateLimit.secondary_window || rateLimit.secondary || snapshot.secondary_window || snapshot.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
    added = true;
  }

  return added;
}

function getCodexReviewRateLimit(data) {
  if (data.code_review_rate_limit || data.review_rate_limit) {
    return data.code_review_rate_limit || data.review_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId.code_review || byLimitId.codex_review || byLimitId.review || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((entry) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
  }) || null;
}

async function getCodexUsage(accessToken, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const normalRateLimit = data.rate_limit || data.rate_limits || data.rate_limits_by_limit_id?.codex || {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

/**
 * Kiro (AWS CodeWhisperer) Usage
 */
function parseKiroQuotaData(data) {
  const usageList = data.usageBreakdownList || [];
  const quotaInfo = {};
  const resetAt = parseResetTime(data.nextDateReset || data.resetDate);

  usageList.forEach((breakdown) => {
    const resourceType = breakdown.resourceType?.toLowerCase() || "unknown";
    const used = breakdown.currentUsageWithPrecision || 0;
    const total = breakdown.usageLimitWithPrecision || 0;

    quotaInfo[resourceType] = {
      used,
      total,
      remaining: total - used,
      resetAt,
      unlimited: false,
    };

    // Add free trial if available
    if (breakdown.freeTrialInfo) {
      const freeUsed = breakdown.freeTrialInfo.currentUsageWithPrecision || 0;
      const freeTotal = breakdown.freeTrialInfo.usageLimitWithPrecision || 0;

      quotaInfo[`${resourceType}_freetrial`] = {
        used: freeUsed,
        total: freeTotal,
        remaining: freeTotal - freeUsed,
        resetAt: parseResetTime(breakdown.freeTrialInfo.freeTrialExpiry || resetAt),
        unlimited: false,
      };
    }
  });

  return {
    plan: data.subscriptionInfo?.subscriptionTitle || "Kiro",
    quotas: quotaInfo,
  };
}

async function getKiroUsage(accessToken, providerSpecificData, proxyOptions = null) {
  // Default profileArn fallback
  const DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
  const profileArn = providerSpecificData?.profileArn || DEFAULT_PROFILE_ARN;
  const authMethod = providerSpecificData?.authMethod || "builder-id";

  const getUsageParams = new URLSearchParams({
    isEmailRequired: "true",
    origin: "AI_EDITOR",
    resourceType: "AGENTIC_REQUEST",
  });

  // For compatibility, try multiple known Kiro usage endpoints
  const attempts = [
    {
      name: "codewhisperer-get",
      run: async () => proxyAwareFetch(
        `https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?${getUsageParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE",
            "user-agent": "aws-sdk-js/1.0.0 KiroIDE",
          },
        },
        proxyOptions
      ),
    },
    {
      name: "codewhisperer-post",
      run: async () => proxyAwareFetch("https://codewhisperer.us-east-1.amazonaws.com", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        }),
      }, proxyOptions),
    },
    {
      name: "q-get",
      run: async () => {
        const params = new URLSearchParams({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        });
        return proxyAwareFetch(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        }, proxyOptions);
      },
    },
  ];

  let sawAuthError = false;
  const errors = [];

  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          sawAuthError = true;
        }
        errors.push(`${attempt.name}:${response.status}${errorText ? `:${errorText}` : ""}`);
        continue;
      }

      const data = await response.json();
      return parseKiroQuotaData(data);
    } catch (error) {
      errors.push(`${attempt.name}:${error.message}`);
    }
  }

  if (sawAuthError && authMethod === "idc") {
    return {
      message: "Kiro quota API is unavailable for the current AWS IAM Identity Center session. Chat may still work. If this persists after renewing your session, reconnect Kiro.",
      quotas: {},
    };
  }

  // Social auth (Google/GitHub) - these use a different token format that may not work with AWS CodeWhisperer quota APIs
  if (sawAuthError && (authMethod === "google" || authMethod === "github")) {
    return {
      message: "Kiro quota API authentication expired. Chat may still work.",
      quotas: {},
    };
  }

  if (sawAuthError) {
    return {
      message: "Kiro quota API rejected the current token. Chat may still work.",
      quotas: {},
    };
  }

  const fallbackMessage =
    errors.length > 0
      ? `Unable to fetch Kiro usage right now. (${errors[errors.length - 1]})`
      : "Unable to fetch Kiro usage right now.";

  return {
    message: fallbackMessage,
    quotas: {},
  };
}

/**
 * Qwen Usage
 */
async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud Usage
 * Ollama Cloud uses an API key from ollama.com/settings/keys
 * and has no public usage API \u2014 free tier has light usage limits (resets every 5h & 7d).
 * This returns an informational message with the plan details.
 */
async function getOllamaUsage(accessToken, providerSpecificData) {
  try {
    // Ollama Cloud does not expose a public quota/usage API.
    // The provider is configured as noAuth with a notice explaining limits.
    // We return a graceful message so the UI shows a friendly state instead of an error.
    const plan = providerSpecificData?.plan || "Free";
    return {
      plan,
      message: "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
      quotas: [],
    };
  } catch (error) {
    return { message: "Unable to fetch Ollama Cloud usage." };
  }
}

/**
 * GLM Coding Plan usage (international + China regions)
 */
async function getGlmUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const region = provider === "glm-cn" ? "china" : "international";
  const quotaUrl = GLM_QUOTA_URLS[region];

  try {
    const response = await proxyAwareFetch(quotaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas = {};

    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false,
      };
    }

    const levelRaw = typeof data.level === "string" ? data.level : "";
    const plan = levelRaw
      ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase()
      : "Unknown";

    return { plan, quotas };
  } catch (error) {
    return { message: `GLM error: ${error.message}` };
  }
}

// \u2500\u2500 MiniMax helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function getMiniMaxField(model, snakeKey, camelKey) {
  if (!model || typeof model !== "object") return null;
  return model[snakeKey] ?? model[camelKey] ?? null;
}

function getMiniMaxModelName(model) {
  return String(getMiniMaxField(model, "model_name", "modelName") || "").trim();
}

function formatMiniMaxQuotaName(model) {
  const rawName = getMiniMaxModelName(model);
  if (!rawName) return "MiniMax";

  // M3+ shared quota pool: MiniMax reports M-series as a single wildcard
  // bucket ("MiniMax-M*"). Newer responses rename it to plain "general".
  // Render both as a friendly series label rather than leaking the
  // asterisk or the vague "general" word to the UI.
  if (rawName === "MiniMax-M*" || rawName === "general") return "M-series";

  return rawName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bTo\b/g, "to")
    .replace(/\bTts\b/g, "TTS")
    .replace(/\bHd\b/g, "HD");
}

function getMiniMaxProvidedPercent(model, snakeKey, camelKey) {
  if (!model || typeof model !== "object") return null;
  const raw = model[snakeKey] ?? model[camelKey];
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function getMiniMaxSessionTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_interval_total_count", "currentIntervalTotalCount")) || 0);
}

function getMiniMaxWeeklyTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_weekly_total_count", "currentWeeklyTotalCount")) || 0);
}

function hasMiniMaxQuota(model) {
  // Old format has real count totals; M3-era M-series buckets ship percent-only
  // (count fields are 0) so accept those too.
  if (getMiniMaxSessionTotal(model) > 0 || getMiniMaxWeeklyTotal(model) > 0) return true;
  if (getMiniMaxProvidedPercent(model, "current_interval_remaining_percent", "currentIntervalRemainingPercent") !== null) return true;
  if (getMiniMaxProvidedPercent(model, "current_weekly_remaining_percent", "currentWeeklyRemainingPercent") !== null) return true;
  return false;
}

function getMiniMaxResetAt(model, capturedAtMs, remainsSnake, remainsCamel, endSnake, endCamel) {
  const remainsMs = Number(getMiniMaxField(model, remainsSnake, remainsCamel)) || 0;
  if (remainsMs > 0) return new Date(capturedAtMs + remainsMs).toISOString();
  return parseResetTime(getMiniMaxField(model, endSnake, endCamel));
}

function buildMiniMaxQuota(total, count, resetAt, countMeansRemaining, providedPercent = null) {
  const safeTotal = Math.max(0, total);
  const used = countMeansRemaining ? Math.max(safeTotal - count, 0) : Math.min(Math.max(0, count), safeTotal);
  const remaining = Math.max(safeTotal - used, 0);
  // M-series buckets ship percent-only (count = 0). Prefer the upstream value
  // when present, otherwise fall back to the computed percentage. When the
  // quota is unbounded (no count) and no upstream percent is available, surface
  // the percent anyway as long as it is defined.
  const remainingPercentage = providedPercentage(providedPercent, remaining, safeTotal);
  return {
    used,
    total: safeTotal,
    remaining,
    remainingPercentage,
    resetAt,
    unlimited: false,
  };
}

function providedPercentage(provided, remaining, total) {
  if (provided !== null && provided !== undefined && Number.isFinite(provided)) {
    return Math.max(0, Math.min(100, provided));
  }
  return total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
}

function addMiniMaxQuota(quotas, key, model, getTotal, countSnake, countCamel, percentSnake, percentCamel, resetArgs, countMeansRemaining) {
  const total = getTotal(model);
  const providedPercent = getMiniMaxProvidedPercent(model, percentSnake, percentCamel);
  if (total <= 0 && providedPercent === null) return;

  const count = Math.max(0, Number(getMiniMaxField(model, countSnake, countCamel)) || 0);
  let effectiveTotal = total;
  let effectiveCount = count;
  if (total <= 0) {
    // M-series bucket: API only ships *_remaining_percent (count = 0). Normalize
    // to total=100. The downstream buildMiniMaxQuota treats the count as
    // "used" or "remaining" depending on countMeansRemaining, so the synthetic
    // count has to match that semantic \u2014 otherwise the UI flips the percentage.
    effectiveTotal = 100;
    const pct = providedPercent;
    effectiveCount = countMeansRemaining
      ? Math.round(effectiveTotal * (pct / 100))
      : Math.round(effectiveTotal * (1 - pct / 100));
  }
  quotas[key] = buildMiniMaxQuota(
    effectiveTotal,
    effectiveCount,
    getMiniMaxResetAt(model, ...resetArgs),
    countMeansRemaining,
    providedPercent
  );
}

/**
 * MiniMax Token Plan / Coding Plan usage
 */
async function getMiniMaxUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "MiniMax API key not available." };
  }

  const usageUrls = MINIMAX_USAGE_URLS[provider] || [];
  let lastErrorMessage = "";

  for (let index = 0; index < usageUrls.length; index += 1) {
    const usageUrl = usageUrls[index];
    const canFallback = index < usageUrls.length - 1;

    try {
      const response = await proxyAwareFetch(usageUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }, proxyOptions);

      const rawText = await response.text();
      let payload = {};
      if (rawText) {
        try { payload = JSON.parse(rawText); } catch { payload = {}; }
      }

      const baseResp = (payload?.base_resp ?? payload?.baseResp) || {};
      const apiStatusCode = Number(baseResp.status_code ?? baseResp.statusCode) || 0;
      const apiStatusMessage = String(baseResp.status_msg ?? baseResp.statusMsg ?? "").trim();
      const combined = `${apiStatusMessage} ${rawText}`.trim();
      const authLike = /token plan|coding plan|invalid api key|invalid key|unauthorized|inactive/i;

      if (response.status === 401 || response.status === 403 || apiStatusCode === 1004 || authLike.test(combined)) {
        return { message: "MiniMax API key invalid or inactive. Use an active Token/Coding Plan key." };
      }

      if (!response.ok) {
        lastErrorMessage = `MiniMax usage endpoint error (${response.status})`;
        if ((response.status === 404 || response.status === 405 || response.status >= 500) && canFallback) continue;
        return { message: `MiniMax connected. ${lastErrorMessage}` };
      }

      if (apiStatusCode !== 0) {
        return { message: `MiniMax connected. ${apiStatusMessage || "Upstream quota API error"}` };
      }

      const modelRemains = payload?.model_remains ?? payload?.modelRemains;
      const allModels = Array.isArray(modelRemains) ? modelRemains : [];
      const quotaModels = allModels.filter(hasMiniMaxQuota);

      if (quotaModels.length === 0) {
        return { message: "MiniMax connected. No quota data was returned." };
      }

      const capturedAtMs = Date.now();
      const countMeansRemaining = usageUrl.includes("/coding_plan/remains");
      const quotas = {};

      for (const model of quotaModels) {
        const displayName = formatMiniMaxQuotaName(model);
        addMiniMaxQuota(
          quotas,
          `${displayName} (5h)`,
          model,
          getMiniMaxSessionTotal,
          "current_interval_usage_count",
          "currentIntervalUsageCount",
          "current_interval_remaining_percent",
          "currentIntervalRemainingPercent",
          [capturedAtMs, "remains_time", "remainsTime", "end_time", "endTime"],
          countMeansRemaining
        );

        addMiniMaxQuota(
          quotas,
          `${displayName} (7d)`,
          model,
          getMiniMaxWeeklyTotal,
          "current_weekly_usage_count",
          "currentWeeklyUsageCount",
          "current_weekly_remaining_percent",
          "currentWeeklyRemainingPercent",
          [capturedAtMs, "weekly_remains_time", "weeklyRemainsTime", "weekly_end_time", "weeklyEndTime"],
          countMeansRemaining
        );
      }

      if (Object.keys(quotas).length === 0) {
        return { message: "MiniMax connected. Unable to extract quota usage." };
      }

      return { quotas };
    } catch (error) {
      lastErrorMessage = error.message;
      if (!canFallback) break;
    }
  }

  return { message: lastErrorMessage ? `MiniMax connected. Unable to fetch usage: ${lastErrorMessage}` : "MiniMax connected. Unable to fetch usage." };
}

async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      "https://openapi.qoder.sh/api/v2/quota/usage",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
      },
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getAutoclawUsage(accessToken, proxyOptions = null, connection = null) {
  if (!accessToken) {
    return { message: "AutoClaw usage unavailable: no access token" };
  }
  try {
    const { AUTOCLAW_WALLET_ENDPOINT, buildAutoClawWalletHeaders } = await import("../../src/lib/autoclaw/constants.js");
    const response = await proxyAwareFetch(
      AUTOCLAW_WALLET_ENDPOINT,
      { method: "GET", headers: buildAutoClawWalletHeaders(accessToken) },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `AutoClaw connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body || body.code !== 0) {
      return { message: "AutoClaw connected. Unable to read balance." };
    }
    const total = Number(body.data?.total_balance);
    const remaining = Number.isFinite(total) ? total : 0;

    // AutoClaw's wallet only returns the CURRENT balance, not how much was spent.
    // To show real consumption, track the highest balance ever seen (baseline)
    // in the cached snapshot: used = baseline - remaining. Baseline grows if the
    // account is topped up.
    let baseline = remaining;
    try {
      if (connection?.id) {
        const { getQuotaSnapshot } = await import("@/lib/localDb.js");
        const prev = await getQuotaSnapshot(connection.id);
        const prevBaseline = Number(prev?.usage?.quotas?.points?.total) || 0;
        const prevRemaining = Number(prev?.usage?.quotas?.points?.remaining);
        // Baseline = max(prev baseline, current remaining). If balance jumped
        // above the old baseline (top-up), adopt the new higher value.
        baseline = Math.max(prevBaseline, remaining, Number.isFinite(prevRemaining) ? prevRemaining : 0);
      }
    } catch { /* first run / no snapshot */ }

    const used = Math.max(0, baseline - remaining);
    const pct = baseline > 0 ? Math.round((remaining / baseline) * 100) : 0;
    return {
      quotas: {
        points: {
          total: baseline,
          used,
          remaining,
          unit: "points",
          resetAt: null,
        },
      },
      totalUsagePercentage: baseline > 0 ? Math.round((used / baseline) * 100) : 0,
      isQuotaExceeded: remaining <= 0,
    };
  } catch (error) {
    return { message: `AutoClaw connected. Unable to fetch balance: ${error.message}` };
  }
}

// ─── DeepSeek ────────────────────────────────────────────────────────────────
// GET https://api.deepseek.com/user/balance
// Returns { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
async function getDeepSeekUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "DeepSeek API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    }, proxyOptions);
    if (!res.ok) {
      if (res.status === 401) return { message: "Invalid DeepSeek API key." };
      return { message: `DeepSeek balance API error (${res.status})` };
    }
    const data = await res.json();
    const quotas = {};
    const balanceInfos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    for (const b of balanceInfos) {
      const currency = (b.currency || "").toUpperCase();
      const total = parseFloat(b.total_balance) || 0;
      const granted = parseFloat(b.granted_balance) || 0;
      const topped = parseFloat(b.topped_up_balance) || 0;
      if (currency) {
        quotas[`balance_${currency.toLowerCase()}`] = {
          used: 0, total: 0, remaining: total,
          remainingPercentage: 100, resetAt: null, unlimited: true,
          currency, grantedBalance: granted, toppedUpBalance: topped,
        };
      }
    }
    const isAvailable = data.is_available !== false;
    return {
      plan: isAvailable ? "DeepSeek" : "DeepSeek (Insufficient Balance)",
      quotas,
    };
  } catch (error) {
    return { message: `DeepSeek connected. Unable to fetch balance: ${error.message}` };
  }
}

// ─── OpenRouter ──────────────────────────────────────────────────────────────
// GET https://openrouter.ai/api/v1/auth/key
// Returns { data: { label, usage, limit, is_free_tier, rate_limit: { requests, interval } } }
async function getOpenRouterUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "OpenRouter API key not available." };
  try {
    const res = await proxyAwareFetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { message: "Invalid OpenRouter API key." };
      return { message: `OpenRouter API error (${res.status})` };
    }
    const json = await res.json();
    const d = json.data || {};
    const usage = d.usage || 0;          // total $ used
    const limit = d.limit || null;       // spending limit (null = unlimited)
    const isFree = d.is_free_tier || false;
    const quotas = {};
    if (limit !== null && limit > 0) {
      const remaining = Math.max(0, limit - usage);
      quotas["credits"] = {
        used: Math.round(usage * 100) / 100,
        total: Math.round(limit * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        remainingPercentage: Math.round((remaining / limit) * 100),
        resetAt: null, unlimited: false, currency: "USD",
      };
    } else {
      quotas["credits"] = {
        used: Math.round(usage * 100) / 100,
        total: 0, remaining: 0, remainingPercentage: 100,
        resetAt: null, unlimited: true, currency: "USD",
      };
    }
    const rateLimit = d.rate_limit || {};
    return {
      plan: isFree ? "OpenRouter (Free Tier)" : "OpenRouter",
      quotas,
      rateLimit: rateLimit.requests ? `${rateLimit.requests} req/${rateLimit.interval || "?"}` : null,
    };
  } catch (error) {
    return { message: `OpenRouter connected. Unable to fetch usage: ${error.message}` };
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
// GET https://api.openai.com/v1/organization/projects (verify key)
// Billing info via /dashboard/billing/credit_grants (session-only, not API key)
// For API keys we can at least verify the key and show subscription info
async function getOpenAIUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "OpenAI API key not available." };
  try {
    // Try the billing credit grants endpoint (works with some key types)
    const billingRes = await proxyAwareFetch("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (billingRes.ok) {
      const data = await billingRes.json();
      const totalGranted = data.total_granted || 0;
      const totalUsed = data.total_used || 0;
      const totalAvailable = data.total_available || 0;
      return {
        plan: "OpenAI",
        quotas: {
          credits: {
            used: Math.round(totalUsed * 100) / 100,
            total: Math.round(totalGranted * 100) / 100,
            remaining: Math.round(totalAvailable * 100) / 100,
            remainingPercentage: totalGranted > 0 ? Math.round((totalAvailable / totalGranted) * 100) : 100,
            resetAt: null, unlimited: false, currency: "USD",
          },
        },
      };
    }
    // Fallback: just verify the key is valid via models endpoint
    const modelsRes = await proxyAwareFetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (modelsRes.status === 401) return { message: "Invalid OpenAI API key." };
    if (modelsRes.ok) {
      return { plan: "OpenAI", message: "OpenAI API key verified. Billing details available at platform.openai.com/usage." };
    }
    return { message: `OpenAI API error (${modelsRes.status})` };
  } catch (error) {
    return { message: `OpenAI connected. Unable to fetch usage: ${error.message}` };
  }
}

// ─── Anthropic (API Key) ─────────────────────────────────────────────────────
// No public balance API for API keys. Verify key + show plan info.
async function getAnthropicUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Anthropic API key not available." };
  try {
    // Try to count tokens as a health check (minimal cost)
    const res = await proxyAwareFetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Anthropic API key." };
    if (res.ok) {
      return { plan: "Anthropic (API Key)", message: "Anthropic API key verified. Billing details available at console.anthropic.com/settings/billing." };
    }
    return { message: `Anthropic API error (${res.status})` };
  } catch (error) {
    return { message: `Anthropic connected. Unable to verify: ${error.message}` };
  }
}

// ─── Mistral ─────────────────────────────────────────────────────────────────
// GET https://api.mistral.ai/v1/models (verify key)
// No public billing API available
async function getMistralUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Mistral API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Mistral API key." };
    if (res.ok) {
      return { plan: "Mistral", message: "Mistral API key verified. Billing details available at console.mistral.ai." };
    }
    return { message: `Mistral API error (${res.status})` };
  } catch (error) {
    return { message: `Mistral connected. Unable to verify: ${error.message}` };
  }
}

// ─── Together AI ─────────────────────────────────────────────────────────────
// GET https://api.together.xyz/v1/billing
// Returns { balance, total_charged, total_granted }
async function getTogetherUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Together AI API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.together.xyz/v1/billing", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Together AI API key." };
    if (res.ok) {
      const data = await res.json();
      const balance = parseFloat(data.balance) || 0;
      const totalCharged = parseFloat(data.total_charged) || 0;
      const totalGranted = parseFloat(data.total_granted) || 0;
      return {
        plan: "Together AI",
        quotas: {
          credits: {
            used: Math.round(totalCharged * 100) / 100,
            total: Math.round(totalGranted * 100) / 100,
            remaining: Math.round(balance * 100) / 100,
            remainingPercentage: totalGranted > 0 ? Math.round((balance / totalGranted) * 100) : 100,
            resetAt: null, unlimited: totalGranted === 0, currency: "USD",
          },
        },
      };
    }
    // Fallback - verify key
    const modelsRes = await proxyAwareFetch("https://api.together.xyz/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (modelsRes.ok) {
      return { plan: "Together AI", message: "Together AI key verified. Check billing at api.together.xyz." };
    }
    return { message: `Together AI API error (${res.status})` };
  } catch (error) {
    return { message: `Together AI connected. Unable to fetch billing: ${error.message}` };
  }
}

// ─── Fireworks AI ────────────────────────────────────────────────────────────
// GET https://api.fireworks.ai/v1/accounts (billing info)
async function getFireworksUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Fireworks AI API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.fireworks.ai/v1/accounts", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Fireworks AI API key." };
    if (res.ok) {
      const data = await res.json();
      const accounts = Array.isArray(data.accounts) ? data.accounts : (Array.isArray(data) ? data : [data]);
      const account = accounts[0] || {};
      const balance = parseFloat(account.balance || account.credits_remaining || 0);
      if (balance > 0 || account.balance !== undefined) {
        return {
          plan: "Fireworks AI",
          quotas: {
            credits: {
              used: 0, total: 0, remaining: Math.round(balance * 100) / 100,
              remainingPercentage: 100, resetAt: null, unlimited: true, currency: "USD",
            },
          },
        };
      }
      return { plan: "Fireworks AI", message: "Fireworks AI key verified. Check billing at fireworks.ai/account." };
    }
    return { plan: "Fireworks AI", message: "Fireworks AI key verified. Billing at fireworks.ai/account." };
  } catch (error) {
    return { message: `Fireworks AI connected. Unable to fetch billing: ${error.message}` };
  }
}

// ─── Groq ────────────────────────────────────────────────────────────────────
// No public billing API. Verify key only.
async function getGroqUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Groq API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Groq API key." };
    if (res.ok) {
      return { plan: "Groq (Free)", message: "Groq API key verified. Free tier with rate limits. Check console.groq.com for details." };
    }
    return { message: `Groq API error (${res.status})` };
  } catch (error) {
    return { message: `Groq connected. Unable to verify: ${error.message}` };
  }
}

// ─── Cohere ──────────────────────────────────────────────────────────────────
// GET https://api.cohere.com/v2/api-keys (verify)
async function getCohereUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Cohere API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.cohere.com/v2/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Cohere API key." };
    if (res.ok) {
      return { plan: "Cohere", message: "Cohere API key verified. Check billing at dashboard.cohere.com." };
    }
    return { message: `Cohere API error (${res.status})` };
  } catch (error) {
    return { message: `Cohere connected. Unable to verify: ${error.message}` };
  }
}

// ─── ElevenLabs ──────────────────────────────────────────────────────────────
// GET https://api.elevenlabs.io/v1/user/subscription
// Returns { tier, character_count, character_limit, ... }
async function getElevenLabsUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "ElevenLabs API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid ElevenLabs API key." };
    if (res.ok) {
      const data = await res.json();
      const used = data.character_count || 0;
      const total = data.character_limit || 0;
      const remaining = Math.max(0, total - used);
      const nextReset = data.next_character_count_reset_unix
        ? new Date(data.next_character_count_reset_unix * 1000).toISOString() : null;
      return {
        plan: `ElevenLabs (${data.tier || "Free"})`,
        quotas: {
          characters: {
            used, total, remaining,
            remainingPercentage: total > 0 ? Math.round((remaining / total) * 100) : 0,
            resetAt: nextReset, unlimited: false,
          },
        },
      };
    }
    return { message: `ElevenLabs API error (${res.status})` };
  } catch (error) {
    return { message: `ElevenLabs connected. Unable to fetch usage: ${error.message}` };
  }
}

// ─── Deepgram ────────────────────────────────────────────────────────────────
// GET https://api.deepgram.com/v1/projects → list projects
// GET https://api.deepgram.com/v1/projects/{id}/balances → balance info
async function getDeepgramUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Deepgram API key not available." };
  try {
    // Get projects first
    const projRes = await proxyAwareFetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
    }, proxyOptions);
    if (projRes.status === 401) return { message: "Invalid Deepgram API key." };
    if (!projRes.ok) return { message: `Deepgram API error (${projRes.status})` };
    const projData = await projRes.json();
    const projects = Array.isArray(projData.projects) ? projData.projects : [];
    if (projects.length === 0) {
      return { plan: "Deepgram", message: "Deepgram key verified but no projects found." };
    }
    // Get balance for first project
    const projectId = projects[0].project_id;
    const balRes = await proxyAwareFetch(`https://api.deepgram.com/v1/projects/${projectId}/balances`, {
      headers: { Authorization: `Token ${apiKey}` },
    }, proxyOptions);
    if (!balRes.ok) {
      return { plan: "Deepgram", message: "Deepgram key verified. Unable to fetch balance." };
    }
    const balData = await balRes.json();
    const balances = Array.isArray(balData.balances) ? balData.balances : [];
    const quotas = {};
    for (const bal of balances) {
      const amount = parseFloat(bal.amount) || 0;
      const units = bal.units || "usd";
      quotas[`balance_${units}`] = {
        used: 0, total: 0, remaining: Math.round(amount * 100) / 100,
        remainingPercentage: 100, resetAt: null, unlimited: true,
        currency: units.toUpperCase(),
      };
    }
    return { plan: "Deepgram", quotas };
  } catch (error) {
    return { message: `Deepgram connected. Unable to fetch balance: ${error.message}` };
  }
}

// ─── Hyperbolic ──────────────────────────────────────────────────────────────
// GET https://api.hyperbolic.xyz/v1/billing/credits
async function getHyperbolicUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "Hyperbolic API key not available." };
  try {
    const res = await proxyAwareFetch("https://api.hyperbolic.xyz/v1/billing/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, proxyOptions);
    if (res.status === 401) return { message: "Invalid Hyperbolic API key." };
    if (res.ok) {
      const data = await res.json();
      const credits = parseFloat(data.credits || data.balance || 0);
      return {
        plan: "Hyperbolic",
        quotas: {
          credits: {
            used: 0, total: 0, remaining: Math.round(credits * 100) / 100,
            remainingPercentage: 100, resetAt: null, unlimited: true, currency: "USD",
          },
        },
      };
    }
    return { plan: "Hyperbolic", message: "Hyperbolic key verified. Check billing at app.hyperbolic.xyz." };
  } catch (error) {
    return { message: `Hyperbolic connected. Unable to fetch credits: ${error.message}` };
  }
}

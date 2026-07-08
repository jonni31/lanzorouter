import { NextResponse } from "next/server";
import { getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

// Connections created via different flows use "apikey", "api_key" or "api-key".
function isApiKeyAuth(authType) {
  return ["apikey", "api_key", "api-key"].includes(String(authType || "").toLowerCase());
}

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name) {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function sanitize(c) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd = {};
    for (const f of SAFE_PSD_FIELDS) {
      if (c.providerSpecificData[f] !== undefined) psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}

function isUsageEligible(connection) {
  // Built-in providers: must be in USAGE_SUPPORTED_PROVIDERS
  if (USAGE_SUPPORTED_PROVIDERS.includes(connection.provider)) {
    return connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  }
  // Custom openai-compatible providers with API keys are always eligible
  // (balance detection is done server-side based on baseUrl)
  if (connection.provider?.startsWith("openai-compatible-chat-") && isApiKeyAuth(connection.authType)) {
    return true;
  }
  return false;
}

// Rank providers so the built-in quota-tracked providers (kiro, qoder,
// antigravity, codebuddy, ...) always come before bulk apikey fleets and
// custom providers. Unknown/custom providers sort last.
function providerRank(provider) {
  const idx = USAGE_SUPPORTED_PROVIDERS.indexOf(provider);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections, sort) {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = providerRank(a.provider);
      const orderB = providerRank(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  // Default ("priority") sort: group by provider rank first so the built-in
  // providers stay on the first pages, then priority within each provider.
  return list.sort((a, b) => {
    const rankA = providerRank(a.provider);
    const rankB = providerRank(b.provider);
    if (rankA !== rankB) return rankA - rankB;
    if ((a.provider || "") !== (b.provider || "")) {
      return (a.provider || "").localeCompare(b.provider || "");
    }
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.name || "").localeCompare(b.name || "");
  });
}

export async function GET(request) {
  try {
    await backfillCodexEmails();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(new Set(eligibleConnections.map((conn) => conn.provider)))
      .sort((a, b) => {
        const rankDiff = providerRank(a) - providerRank(b);
        return rankDiff !== 0 ? rankDiff : a.localeCompare(b);
      });

    // Friendly display names for custom provider nodes (openai-compatible-chat-<uuid>)
    const providerLabels = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes || []) {
        if (node?.id && node?.name && providerOptions.includes(node.id)) {
          providerLabels[node.id] = node.name;
        }
      }
    } catch {
      // Non-fatal: dropdown falls back to raw ids
    }

    const providerFilteredConnections = eligibleConnections.filter((conn) => (
      provider === "all" || conn.provider === provider
    ));

    const accountFilteredConnections = providerFilteredConnections.filter((conn) => {
      if (accountStatus === "active") return conn.isActive ?? true;
      if (accountStatus === "inactive") return !(conn.isActive ?? true);
      return true;
    });

    const sortedConnections = sortConnections(accountFilteredConnections, sort);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections.slice(offset, offset + pageSize).map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      providerLabels,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
      },
    });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

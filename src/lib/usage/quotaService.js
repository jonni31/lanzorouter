// Shared quota service: refresh credentials, fetch upstream usage, and write a
// server-side cache snapshot. Used by both the /api/usage route (live view) and
// the background refresh loop (routing cache). Extracted so both paths share one
// implementation of the refresh→fetch→cache flow.

import "open-sse/index.js"; // ensure proxyFetch patches globalThis.fetch
import { getProviderConnectionById, updateProviderConnection, saveQuotaSnapshot } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Refresh credentials via the provider executor and persist any updated tokens.
 * @returns {Promise<{connection, refreshed: boolean}>}
 */
export async function refreshAndUpdateCredentials(connection, force = false, proxyOptions = null) {
  const executor = getExecutor(connection.provider);

  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,
    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  const needsRefresh = force || executor.needsRefresh(credentials);
  if (!needsRefresh) return { connection, refreshed: false };

  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);
  if (!refreshResult) {
    if (connection.accessToken) return { connection, refreshed: false };
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (refreshResult.accessToken) updateData.accessToken = refreshResult.accessToken;
  if (refreshResult.refreshToken) updateData.refreshToken = refreshResult.refreshToken;
  if (refreshResult.idToken) updateData.idToken = refreshResult.idToken;
  if (refreshResult.lastRefreshAt) updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
    ...(refreshResult.copilotToken ? { copilotToken: refreshResult.copilotToken } : {}),
    ...(refreshResult.copilotTokenExpiresAt ? { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  await updateProviderConnection(connection.id, updateData);
  const updatedConnection = {
    ...connection,
    ...updateData,
    providerSpecificData: updateData.providerSpecificData || connection.providerSpecificData,
  };
  return { connection: updatedConnection, refreshed: true };
}

function isUsageEligible(connection) {
  if (!connection) return false;
  if (connection.authType === "oauth") return true;
  return connection.authType === "apikey" && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
}

/**
 * Full usage flow for one connection: resolve proxy → refresh token (OAuth) →
 * fetch upstream usage → retry once on auth-expired. Optionally write the result
 * to the server-side quota cache. Returns the usage object (may contain
 * {quotas}, {message}, {accountDead}). Does not throw for expected states.
 *
 * @param {string} connectionId
 * @param {object} opts { writeCache?: boolean, force?: boolean }
 */
export async function resolveUsageForConnection(connectionId, opts = {}) {
  const { writeCache = false, force = false } = opts;
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) return { error: "Connection not found", notFound: true };

  if (!isUsageEligible(connection)) {
    return { message: "Usage not available for this connection" };
  }

  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  let conn = connection;
  const isOAuth = conn.authType === "oauth";

  if (isOAuth) {
    const result = await refreshAndUpdateCredentials(conn, force, proxyOptions);
    conn = result.connection;
  }

  let usage = await getUsageForProvider(conn, proxyOptions);

  if (isOAuth && isAuthExpiredMessage(usage) && conn.refreshToken) {
    try {
      const retry = await refreshAndUpdateCredentials(conn, true, proxyOptions);
      conn = retry.connection;
      usage = await getUsageForProvider(conn, proxyOptions);
    } catch (retryError) {
      console.warn(`[Usage] ${conn.provider}: force refresh failed: ${retryError.message}`);
    }
  }

  if (writeCache && usage && !usage.error) {
    try {
      await saveQuotaSnapshot(conn.id, conn.provider, usage);
    } catch (e) {
      console.warn(`[QuotaCache] save failed for ${conn.id}: ${e.message}`);
    }
  }

  return usage;
}

export { isUsageEligible };

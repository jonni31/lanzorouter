/**
 * Auto-clean zero credit connections
 * Deletes connections with balance <= 0 when provider has auto-clean enabled.
 * Cross-references both connection fields AND quotaCache snapshots.
 */

import { getSettings } from "./db/repos/settingsRepo.js";
import { getProviderConnections, deleteProviderConnection } from "./db/repos/connectionsRepo.js";
import { getAllQuotaSnapshots } from "./db/repos/quotaCacheRepo.js";

/**
 * Check if a connection has zero/negative balance using both connection data
 * and quota cache snapshot.
 */
function isBalanceDepleted(conn, snapshot) {
  // Direct balance on connection record
  if (conn.balance !== undefined && conn.balance !== null && conn.balance <= 0) {
    return { depleted: true, source: "connection", balance: conn.balance };
  }
  // Check quota cache for accountDead or zero balance
  if (snapshot?.usage) {
    if (snapshot.usage.accountDead === true) {
      return { depleted: true, source: "quotaCache", reason: "accountDead" };
    }
    if (snapshot.usage.balance !== undefined && snapshot.usage.balance !== null && snapshot.usage.balance <= 0) {
      return { depleted: true, source: "quotaCache", balance: snapshot.usage.balance };
    }
  }
  return { depleted: false };
}

/**
 * Check if a connection has exhausted quota using both connection data
 * and quota cache snapshot.
 */
function isQuotaDepleted(conn, snapshot) {
  const now = Date.now();
  const GRACE_MS = 3600000; // 1 hour grace period after reset

  // Check direct quotaRemaining on connection
  if (conn.quotaRemaining !== undefined && conn.quotaRemaining !== null && conn.quotaRemaining <= 0) {
    const resetAt = conn.quotaResetAt ? new Date(conn.quotaResetAt).getTime() : 0;
    if (!resetAt || now > resetAt + GRACE_MS) {
      return { depleted: true, source: "connection", quotaRemaining: conn.quotaRemaining };
    }
  }

  // Check quota cache for all models
  if (snapshot?.usage?.quotas && typeof snapshot.usage.quotas === "object") {
    const quotas = snapshot.usage.quotas;
    const models = Object.keys(quotas);
    if (models.length > 0) {
      const allExhausted = models.every(m => {
        const q = quotas[m];
        if (!q) return false;
        // remainingPercentage === 0 means fully exhausted
        if (typeof q.remainingPercentage === "number" && q.remainingPercentage <= 0) return true;
        if (typeof q.remaining === "number" && q.remaining <= 0) return true;
        return false;
      });
      if (allExhausted) {
        return { depleted: true, source: "quotaCache", models: models.length };
      }
    }
  }

  return { depleted: false };
}

/**
 * Clean zero-balance connections for providers with auto-clean enabled
 * @returns {object} - { cleaned: number, providers: string[] }
 */
export async function cleanZeroBalanceConnections() {
  const settings = await getSettings();
  const autoCleanProviders = settings.providerAutoClean || {};
  
  const cleaned = [];
  const errors = [];

  // Pre-fetch all quota snapshots for efficient lookup
  const allSnapshots = await getAllQuotaSnapshots();
  const snapshotMap = new Map(allSnapshots.map(s => [s.connectionId, s]));

  for (const [provider, enabled] of Object.entries(autoCleanProviders)) {
    if (!enabled) continue;

    try {
      const connections = await getProviderConnections({ provider });
      
      for (const conn of connections) {
        const snapshot = snapshotMap.get(conn.id);
        const result = isBalanceDepleted(conn, snapshot);
        if (result.depleted) {
          const detail = result.source === "quotaCache" 
            ? `(${result.reason || `balance: $${result.balance}`} via quotaCache)`
            : `(balance: $${result.balance})`;
          console.log(`[AUTO-CLEAN] Deleting ${provider} connection ${conn.name || conn.id} ${detail}`);
          await deleteProviderConnection(conn.id);
          cleaned.push({ provider, id: conn.id, name: conn.name, ...result });
        }
      }
    } catch (err) {
      console.error(`[AUTO-CLEAN] Failed to clean ${provider}: ${err.message}`);
      errors.push({ provider, error: err.message });
    }
  }

  const summary = {
    cleaned: cleaned.length,
    providers: [...new Set(cleaned.map(c => c.provider))],
    details: cleaned,
    errors
  };

  if (cleaned.length > 0) {
    console.log(`[AUTO-CLEAN] Cleaned ${cleaned.length} connections from ${summary.providers.join(", ")}`);
  }

  return summary;
}

/**
 * Clean quota-exhausted connections
 * Only for providers with auto-clean enabled
 */
export async function cleanQuotaExhaustedConnections() {
  const settings = await getSettings();
  const autoCleanProviders = settings.providerAutoClean || {};
  
  const cleaned = [];
  const errors = [];

  // Pre-fetch all quota snapshots
  const allSnapshots = await getAllQuotaSnapshots();
  const snapshotMap = new Map(allSnapshots.map(s => [s.connectionId, s]));

  for (const [provider, enabled] of Object.entries(autoCleanProviders)) {
    if (!enabled) continue;

    try {
      const connections = await getProviderConnections({ provider });
      
      for (const conn of connections) {
        const snapshot = snapshotMap.get(conn.id);
        const result = isQuotaDepleted(conn, snapshot);
        if (result.depleted) {
          const detail = result.source === "quotaCache"
            ? `(all ${result.models} models exhausted via quotaCache)`
            : `(quotaRemaining: ${result.quotaRemaining})`;
          console.log(`[AUTO-CLEAN] Deleting ${provider} connection ${conn.name || conn.id} ${detail}`);
          await deleteProviderConnection(conn.id);
          cleaned.push({ provider, id: conn.id, name: conn.name, ...result });
        }
      }
    } catch (err) {
      console.error(`[AUTO-CLEAN] Failed to clean ${provider}: ${err.message}`);
      errors.push({ provider, error: err.message });
    }
  }

  const summary = {
    cleaned: cleaned.length,
    providers: [...new Set(cleaned.map(c => c.provider))],
    details: cleaned,
    errors
  };

  if (cleaned.length > 0) {
    console.log(`[AUTO-CLEAN] Cleaned ${cleaned.length} quota-exhausted connections from ${summary.providers.join(", ")}`);
  }

  return summary;
}

/**
 * Run both cleaners
 */
export async function runAutoClean() {
  console.log(`[AUTO-CLEAN] Starting auto-clean at ${new Date().toISOString()}`);
  
  const balanceResult = await cleanZeroBalanceConnections();
  const quotaResult = await cleanQuotaExhaustedConnections();
  
  return {
    balance: balanceResult,
    quota: quotaResult,
    total: balanceResult.cleaned + quotaResult.cleaned
  };
}

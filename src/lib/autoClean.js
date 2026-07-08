/**
 * Auto-clean zero credit connections
 * Deletes connections with balance <= 0 when provider has auto-clean enabled
 */

import { getSettings } from "./db/repos/settingsRepo.js";
import { getProviderConnections, deleteProviderConnection } from "./db/repos/connectionsRepo.js";

/**
 * Clean zero-balance connections for providers with auto-clean enabled
 * @returns {object} - { cleaned: number, providers: string[] }
 */
export async function cleanZeroBalanceConnections() {
  const settings = await getSettings();
  const autoCleanProviders = settings.providerAutoClean || {};
  
  const cleaned = [];
  const errors = [];

  for (const [provider, enabled] of Object.entries(autoCleanProviders)) {
    if (!enabled) continue;

    try {
      const connections = await getProviderConnections({ provider });
      
      for (const conn of connections) {
        // Check if balance is defined and <= 0
        if (conn.balance !== undefined && conn.balance !== null && conn.balance <= 0) {
          console.log(`[AUTO-CLEAN] Deleting ${provider} connection ${conn.name || conn.id} (balance: $${conn.balance})`);
          await deleteProviderConnection(conn.id);
          cleaned.push({ provider, id: conn.id, name: conn.name, balance: conn.balance });
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
 * Clean quota-exhausted connections (quotaRemaining = 0)
 * Only for providers with auto-clean enabled
 */
export async function cleanQuotaExhaustedConnections() {
  const settings = await getSettings();
  const autoCleanProviders = settings.providerAutoClean || {};
  
  const cleaned = [];
  const errors = [];

  for (const [provider, enabled] of Object.entries(autoCleanProviders)) {
    if (!enabled) continue;

    try {
      const connections = await getProviderConnections({ provider });
      
      for (const conn of connections) {
        // Check if quota is exhausted (remaining = 0)
        if (conn.quotaRemaining !== undefined && conn.quotaRemaining !== null && conn.quotaRemaining <= 0) {
          // Only delete if quota reset time has passed (permanent exhaustion)
          const now = Date.now();
          const resetAt = conn.quotaResetAt ? new Date(conn.quotaResetAt).getTime() : 0;
          
          // If no reset time, or reset time is in the past (quota should've refreshed but didn't)
          if (!resetAt || now > resetAt + 3600000) { // 1 hour grace period after reset
            console.log(`[AUTO-CLEAN] Deleting ${provider} connection ${conn.name || conn.id} (quota exhausted)`);
            await deleteProviderConnection(conn.id);
            cleaned.push({ provider, id: conn.id, name: conn.name, quotaRemaining: conn.quotaRemaining });
          }
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

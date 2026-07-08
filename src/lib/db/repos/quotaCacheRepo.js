import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

/**
 * Quota cache repo — server-side snapshots of upstream per-account quota.
 *
 * A background loop (see open-sse/services/quotaRefresh.js) periodically calls
 * getUsageForProvider() and writes the result here so request routing can read
 * remaining quota synchronously (one SQLite lookup) instead of a live network
 * call. One row per connection.
 */

/**
 * Upsert a quota snapshot for a connection.
 * @param {string} connectionId
 * @param {string} provider
 * @param {object} usage - the object returned by getUsageForProvider (quotas, plan, message, accountDead...)
 */
export async function saveQuotaSnapshot(connectionId, provider, usage) {
  if (!connectionId) return;
  const db = await getAdapter();
  const fetchedAt = new Date().toISOString();
  db.run(
    `INSERT INTO quotaCache(connectionId, provider, data, fetchedAt) VALUES(?, ?, ?, ?)
     ON CONFLICT(connectionId) DO UPDATE SET provider = excluded.provider, data = excluded.data, fetchedAt = excluded.fetchedAt`,
    [connectionId, provider || "", stringifyJson(usage || {}), fetchedAt]
  );
}

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    connectionId: row.connectionId,
    provider: row.provider,
    fetchedAt: row.fetchedAt,
    usage: parseJson(row.data, {}),
  };
}

/** Get one connection's cached snapshot, or null. */
export async function getQuotaSnapshot(connectionId) {
  if (!connectionId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT connectionId, provider, data, fetchedAt FROM quotaCache WHERE connectionId = ?`,
    [connectionId]
  );
  return rowToSnapshot(row);
}

/** Get all cached snapshots (optionally filtered by provider). */
export async function getAllQuotaSnapshots(provider = null) {
  const db = await getAdapter();
  const rows = provider
    ? db.all(`SELECT connectionId, provider, data, fetchedAt FROM quotaCache WHERE provider = ?`, [provider])
    : db.all(`SELECT connectionId, provider, data, fetchedAt FROM quotaCache`);
  return rows.map(rowToSnapshot);
}

/** Delete a connection's snapshot (e.g. when the connection is removed). */
export async function deleteQuotaSnapshot(connectionId) {
  if (!connectionId) return;
  const db = await getAdapter();
  db.run(`DELETE FROM quotaCache WHERE connectionId = ?`, [connectionId]);
}

/**
 * Read the best remaining-quota percentage for a connection+model from cache.
 * Returns a number 0..100, or null when unknown (no snapshot / model absent).
 * Used by the router's "most-quota" strategy.
 */
export async function getCachedRemainingPercent(connectionId, model) {
  const snap = await getQuotaSnapshot(connectionId);
  if (!snap) return null;
  const quotas = snap.usage?.quotas;
  if (!quotas || typeof quotas !== "object") return null;
  const q = quotas[model];
  if (!q || typeof q.remainingPercentage !== "number") return null;
  return q.remainingPercentage;
}

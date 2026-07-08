import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";

// One-time VACUUM marker. Bump the suffix if we ever need to force a re-run.
const VACUUM_DONE_KEY = "usageHistoryVacuum_v1";

// How often the lightweight recurring prune runs.
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function getRetentionDays() {
  const d = parseInt(process.env.USAGE_HISTORY_RETENTION_DAYS || "60", 10);
  return Number.isFinite(d) && d > 0 ? d : 60;
}

function cutoffIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// Delete usageHistory rows older than `days`. Returns rows removed (best-effort).
// NOTE: aggregate charts (7d/30d/60d) read from the usageDaily table, NOT from
// usageHistory, so pruning raw history does not affect historical stats.
export function pruneUsageHistory(adapter, days = getRetentionDays()) {
  if (!adapter || !days || days <= 0) return 0;
  try {
    const before = adapter.get(`SELECT COUNT(*) as c FROM usageHistory`)?.c ?? 0;
    adapter.run(`DELETE FROM usageHistory WHERE timestamp < ?`, [cutoffIso(days)]);
    const after = adapter.get(`SELECT COUNT(*) as c FROM usageHistory`)?.c ?? 0;
    return Math.max(0, before - after);
  } catch (e) {
    console.warn(`[DB][maintenance] prune failed: ${e.message}`);
    return 0;
  }
}

// Called once per adapter init (from driver.initAdapter, after migrations).
// 1) One-time prune + VACUUM to reclaim pre-existing bloat (gated by _meta).
// 2) Start a recurring prune so usageHistory stays bounded going forward.
export function runStartupMaintenanceOnce(adapter) {
  if (!adapter) return;

  // --- One-time reclaim (prune + VACUUM) ---
  try {
    if (!getMetaSync(adapter, VACUUM_DONE_KEY, null)) {
      const days = getRetentionDays();
      const deleted = pruneUsageHistory(adapter, days);
      try {
        // VACUUM rebuilds the file and MUST run outside any transaction.
        // On a large legacy DB this can take a while and briefly locks the DB.
        adapter.exec(`VACUUM`);
        setMetaSync(adapter, VACUUM_DONE_KEY, new Date().toISOString());
        console.log(`[DB][maintenance] one-time prune (<${days}d, ${deleted} rows) + VACUUM done`);
      } catch (e) {
        // Leave the flag unset so VACUUM is retried on the next boot.
        console.warn(`[DB][maintenance] VACUUM failed, will retry next boot: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[DB][maintenance] startup maintenance skipped: ${e.message}`);
  }

  // --- Recurring lightweight prune (DELETE only; free pages get reused) ---
  if (!global._usageHistoryPruneTimer) {
    try {
      global._usageHistoryPruneTimer = setInterval(() => {
        try { pruneUsageHistory(adapter); } catch {}
      }, PRUNE_INTERVAL_MS);
      // Don't keep the process alive just for this timer.
      if (typeof global._usageHistoryPruneTimer.unref === "function") {
        global._usageHistoryPruneTimer.unref();
      }
    } catch {}
  }
}

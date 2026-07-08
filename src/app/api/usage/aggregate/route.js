import { NextResponse } from "next/server";
import { getAllQuotaSnapshots } from "@/lib/db/repos/quotaCacheRepo";
import { getProviderConnections } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver";

/**
 * Get today's usage stats for a specific provider from usageDaily table.
 * Returns { requests, promptTokens, completionTokens, totalTokens } or null.
 */
async function getTodayUsageForProvider(provider) {
  try {
    const db = await getAdapter();
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
    if (!row) return null;

    const dayData = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    const byProvider = dayData?.byProvider || {};

    // Match exact provider or any provider that starts with the given prefix
    // (custom providers have UUIDs as suffixes)
    const stats = byProvider[provider];
    if (stats) {
      return {
        requests: stats.requests || 0,
        promptTokens: stats.promptTokens || 0,
        completionTokens: stats.completionTokens || 0,
        totalTokens: (stats.promptTokens || 0) + (stats.completionTokens || 0),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/usage/aggregate?provider=antigravity
 *
 * Returns aggregated quota data across ALL connections of a provider, reading
 * from the server-side quotaCache (populated by the background refresh loop).
 * This avoids the client having to fetch quota per-connection for every account
 * just to build an aggregate card.
 *
 * Response shape matches what the client's parseQuotaData expects:
 *   { plan, quotas: { [modelKey]: { used, total, resetAt, remainingPercentage, displayName } }, accountCount, activeCount, deadCount }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider) {
      return NextResponse.json({ error: "provider query param required" }, { status: 400 });
    }

    // Get all connections for this provider to know the full count
    const allConnections = await getProviderConnections({ provider });
    const activeConnections = allConnections.filter((c) => c.isActive ?? true);

    // Get all cached quota snapshots for this provider
    const snapshots = await getAllQuotaSnapshots(provider);

    // Build a set of active connection IDs for filtering
    const activeIds = new Set(activeConnections.map((c) => c.id));

    // Aggregate quotas across all snapshots (only active connections)
    const aggregated = {};
    let accountsWithQuota = 0;
    let deadCount = 0;

    for (const snap of snapshots) {
      // Only aggregate active connections
      if (!activeIds.has(snap.connectionId)) continue;

      const usage = snap.usage;
      if (!usage) continue;

      if (usage.accountDead) {
        deadCount++;
        continue;
      }

      const quotas = usage.quotas;
      if (!quotas || typeof quotas !== "object" || Object.keys(quotas).length === 0) continue;

      accountsWithQuota++;

      for (const [modelKey, quota] of Object.entries(quotas)) {
        if (!aggregated[modelKey]) {
          aggregated[modelKey] = {
            used: 0,
            total: 0,
            resetAt: null,
            displayName: quota.displayName || modelKey,
            remainingPercentage: null, // Will compute after summing
            unlimited: false,
          };
        }

        aggregated[modelKey].used += Number(quota.used) || 0;
        aggregated[modelKey].total += Number(quota.total) || 0;

        // Use the earliest resetAt across all accounts
        if (quota.resetAt) {
          if (!aggregated[modelKey].resetAt ||
              new Date(quota.resetAt).getTime() < new Date(aggregated[modelKey].resetAt).getTime()) {
            aggregated[modelKey].resetAt = quota.resetAt;
          }
        }
      }
    }

    // Compute remaining percentage from aggregated used/total
    for (const quota of Object.values(aggregated)) {
      if (quota.total > 0) {
        quota.remainingPercentage = ((quota.total - quota.used) / quota.total) * 100;
      } else {
        quota.remainingPercentage = 0;
      }
    }

    // When no numeric quotas exist (provider without a balance API), surface
    // the informational message from the snapshots so the bulk card can show it.
    let message = null;
    if (Object.keys(aggregated).length === 0) {
      for (const snap of snapshots) {
        if (activeIds.has(snap.connectionId) && snap.usage?.message) {
          message = snap.usage.message;
          break;
        }
      }
    }

    // Always include today's internal usage stats so the frontend can display
    // requests/tokens even for providers without a balance API.
    const usageStats = await getTodayUsageForProvider(provider);

    return NextResponse.json({
      plan: provider.charAt(0).toUpperCase() + provider.slice(1),
      quotas: aggregated,
      message,
      usageStats,
      accountCount: activeConnections.length,
      accountsWithQuota,
      deadCount,
    });
  } catch (error) {
    console.error("[API] Failed to aggregate usage:", error);
    return NextResponse.json(
      { error: "Failed to aggregate usage" },
      { status: 500 }
    );
  }
}

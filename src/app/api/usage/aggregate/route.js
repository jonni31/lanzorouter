import { NextResponse } from "next/server";
import { getQuotaSnapshot } from "@/lib/db/repos/quotaCacheRepo";
import { getProviderConnections } from "@/lib/localDb";
import { resolveUsageForConnection } from "@/lib/usage/quotaService";

/**
 * GET /api/usage/aggregate?provider=<id>[&refresh=1]
 *
 * Returns aggregated quota across ALL connections of a provider so the dashboard
 * can render one "bulk" card per provider instead of per-key rows.
 *
 * Snapshots are looked up per-connectionId (not by a provider filter) so the
 * legacy cache naming (e.g. "codex") vs split connection ids (e.g. "codex-free")
 * mismatch never yields an empty aggregate. On refresh=1 we fetch live for every
 * connection and re-write the cache keyed by the connection's split provider id.
 *
 * Response shape matches parseQuotaData's expectation:
 *   { plan, quotas: { [modelKey]: { used, total, resetAt, remainingPercentage, displayName } },
 *     accountCount, accountsWithQuota, deadCount }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const refresh = searchParams.get("refresh") === "1";

    if (!provider) {
      return NextResponse.json({ error: "provider query param required" }, { status: 400 });
    }

    const allConnections = await getProviderConnections({ provider });
    const activeConnections = allConnections.filter((c) => c.isActive ?? true);

    // Gather one usage object per active connection: either fetched live
    // (refresh) or read from the per-connection cache snapshot.
    const usages = [];
    if (refresh) {
      // Fetch live for all active connections in parallel; writeCache re-keys
      // the snapshot to the connection's split provider id.
      const results = await Promise.allSettled(
        activeConnections.map((c) =>
          resolveUsageForConnection(c.id, { writeCache: true, force: false }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) usages.push(r.value);
      }
    } else {
      for (const c of activeConnections) {
        const snap = await getQuotaSnapshot(c.id);
        if (snap?.usage) usages.push(snap.usage);
      }
    }

    // Aggregate quotas across all usages.
    const aggregated = {};
    let accountsWithQuota = 0;
    let deadCount = 0;

    for (const usage of usages) {
      if (!usage) continue;
      if (usage.accountDead) {
        deadCount++;
        continue;
      }
      const quotas = usage.quotas;
      if (!quotas || typeof quotas !== "object" || Object.keys(quotas).length === 0) continue;

      accountsWithQuota++;

      for (const [modelKey, quota] of Object.entries(quotas)) {
        if (!quota || typeof quota !== "object") continue;
        if (!aggregated[modelKey]) {
          aggregated[modelKey] = {
            used: 0,
            total: 0,
            resetAt: null,
            displayName: quota.displayName || modelKey,
            remainingPercentage: null,
            unlimited: false,
          };
        }
        aggregated[modelKey].used += Number(quota.used) || 0;
        aggregated[modelKey].total += Number(quota.total) || 0;
        if (quota.unlimited) aggregated[modelKey].unlimited = true;

        // Earliest resetAt across all accounts.
        if (quota.resetAt) {
          const cur = aggregated[modelKey].resetAt;
          if (!cur || new Date(quota.resetAt).getTime() < new Date(cur).getTime()) {
            aggregated[modelKey].resetAt = quota.resetAt;
          }
        }
      }
    }

    // Compute remaining percentage from summed used/total.
    for (const quota of Object.values(aggregated)) {
      if (quota.unlimited) {
        quota.remainingPercentage = 100;
      } else if (quota.total > 0) {
        quota.remainingPercentage = ((quota.total - quota.used) / quota.total) * 100;
      } else {
        quota.remainingPercentage = 0;
      }
    }

    return NextResponse.json({
      plan: provider.charAt(0).toUpperCase() + provider.slice(1),
      quotas: aggregated,
      accountCount: activeConnections.length,
      accountsWithQuota,
      deadCount,
    });
  } catch (error) {
    console.error("[API] Failed to aggregate usage:", error);
    return NextResponse.json({ error: "Failed to aggregate usage" }, { status: 500 });
  }
}

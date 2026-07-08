// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getQuotaSnapshot } from "@/lib/localDb";
import { resolveUsageForConnection } from "@/lib/usage/quotaService";

// Serve cached quota when it's fresher than this; otherwise fetch live.
const CACHE_FRESH_MS = 60 * 1000;

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection.
 *
 * Reads the server-side quota cache first (instant); only hits the upstream API
 * when the cache is stale or `?refresh=1` is passed. Live fetches also write the
 * cache so routing + dashboard stay in sync.
 */
export async function GET(request, { params }) {
  let connectionId;
  try {
    ({ connectionId } = await params);
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";

    if (!force) {
      const snap = await getQuotaSnapshot(connectionId);
      if (snap?.usage && Date.now() - new Date(snap.fetchedAt).getTime() < CACHE_FRESH_MS) {
        return Response.json({ ...snap.usage, cached: true, fetchedAt: snap.fetchedAt });
      }
    }

    const usage = await resolveUsageForConnection(connectionId, { writeCache: true, force });
    if (usage?.notFound) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }
    return Response.json(usage);
  } catch (error) {
    console.warn(`[Usage] ${connectionId || "unknown"}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Background quota refresh loop.
//
// Periodically snapshots each active, usage-eligible connection's upstream quota
// into the server-side quota cache (quotaCache table) so request routing can read
// remaining quota synchronously. Requests are staggered to avoid a burst of
// upstream calls. Guarded via globalThis so Next.js hot-reload / multiple imports
// don't start duplicate loops.

import { getProviderConnections } from "@/lib/localDb";
import { resolveUsageForConnection, isUsageEligible } from "./quotaService.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // full sweep cadence per connection
const STAGGER_MS = 4 * 1000;               // gap between connections in a sweep
const MIN_START_DELAY_MS = 15 * 1000;      // let the server settle before first sweep

if (!globalThis._quotaRefreshState) {
  globalThis._quotaRefreshState = { started: false, timer: null, running: false };
}
const state = globalThis._quotaRefreshState;

async function sweepOnce() {
  if (state.running) return;
  state.running = true;
  try {
    let connections = [];
    try {
      connections = await getProviderConnections({ isActive: true });
    } catch (e) {
      console.warn(`[QuotaRefresh] failed to list connections: ${e.message}`);
      return;
    }
    const eligible = connections.filter(isUsageEligible);
    for (const conn of eligible) {
      try {
        await resolveUsageForConnection(conn.id, { writeCache: true });
      } catch (e) {
        console.warn(`[QuotaRefresh] ${conn.provider}/${conn.id}: ${e.message}`);
      }
      // Stagger to avoid hammering upstreams all at once.
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  } finally {
    state.running = false;
  }
}

/** Start the background loop once per process. Safe to call repeatedly. */
export function startQuotaRefreshLoop() {
  if (state.started) return;
  state.started = true;
  setTimeout(() => {
    void sweepOnce();
    state.timer = setInterval(() => void sweepOnce(), REFRESH_INTERVAL_MS);
    if (state.timer.unref) state.timer.unref();
  }, MIN_START_DELAY_MS);
}

/** Trigger an immediate one-off sweep (fire-and-forget). */
export function refreshQuotaNow() {
  void sweepOnce();
}

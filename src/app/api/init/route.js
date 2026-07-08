// This API route is called automatically to initialize app
import { startQuotaRefreshLoop } from "@/lib/usage/quotaRefresh";

export async function GET() {
  // Start the background quota-refresh loop (guarded so it only starts once).
  try {
    startQuotaRefreshLoop();
  } catch (e) {
    console.warn(`[Init] quota refresh loop start failed: ${e.message}`);
  }
  return new Response("Initialized", { status: 200 });
}

import { runAutoClean } from "@/lib/autoClean.js";

export const dynamic = "force-dynamic";

/**
 * Auto-clean cron endpoint
 * Run via cron job or manual trigger
 * GET /api/cron/auto-clean
 */
export async function GET(request) {
  try {
    // Optional: Add auth header check for cron security
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET || "lanzo-cron-secret";
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await runAutoClean();
    
    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });
  } catch (error) {
    console.error("[AUTO-CLEAN API]", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

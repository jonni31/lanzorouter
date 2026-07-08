import { NextResponse } from "next/server";
import { getProviderConnections, deleteProviderConnection } from "@/lib/localDb";

/**
 * POST /api/providers/bulk-delete
 *
 * Bulk delete connections filtered by provider and email domain type.
 *
 * Body: { provider: string, emailFilter: "gsuite" | "gmail" | "all" }
 *   - gsuite: delete accounts where email does NOT end with @gmail.com
 *   - gmail:  delete accounts where email ends with @gmail.com
 *   - all:    delete ALL accounts for the provider
 *
 * Returns: { deleted: number, ids: string[] }
 */
export async function POST(request) {
  try {
    const { provider, emailFilter } = await request.json();

    if (!provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (!["gsuite", "gmail", "all"].includes(emailFilter)) {
      return NextResponse.json({ error: "emailFilter must be 'gsuite', 'gmail', or 'all'" }, { status: 400 });
    }

    const allConnections = await getProviderConnections({ provider });

    const toDelete = allConnections.filter((conn) => {
      const email = (conn.email || conn.name || "").toLowerCase();
      if (emailFilter === "gmail") {
        return email.endsWith("@gmail.com");
      }
      if (emailFilter === "gsuite") {
        return email.includes("@") && !email.endsWith("@gmail.com");
      }
      return true; // "all"
    });

    const deletedIds = [];
    for (const conn of toDelete) {
      try {
        await deleteProviderConnection(conn.id);
        deletedIds.push(conn.id);
      } catch (e) {
        console.warn(`[BulkDelete] Failed to delete ${conn.id}: ${e.message}`);
      }
    }

    return NextResponse.json({
      deleted: deletedIds.length,
      total: allConnections.length,
      remaining: allConnections.length - deletedIds.length,
      ids: deletedIds,
    });
  } catch (error) {
    console.error("[BulkDelete] Error:", error);
    return NextResponse.json({ error: "Failed to bulk delete" }, { status: 500 });
  }
}

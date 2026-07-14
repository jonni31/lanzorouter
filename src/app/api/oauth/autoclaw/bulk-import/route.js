import { NextResponse } from "next/server";
import { getAutoclawBulkImportManager, parseKiroBulkAccounts } from "@/lib/oauth/services/autoclawBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);

    if (!parsed.length) {
      return NextResponse.json(
        { error: "At least one account entry is required" },
        { status: 400 }
      );
    }

    if (invalidLines.length > 0) {
      return NextResponse.json(
        {
          error: "Invalid account format. Use one account per line: email@gmail.com:password or email@gmail.com|password",
          invalidLines,
        },
        { status: 400 }
      );
    }

    const manager = getAutoclawBulkImportManager();
    const job = await manager.startJob({
      accounts,
      concurrency: body?.concurrency,
      engine: body?.engine,
      proxyPoolMode: body?.proxyPoolMode,
      proxyPoolId: body?.proxyPoolId,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    const status = Array.isArray(error?.invalidLines) ? 400 : 500;
    return NextResponse.json(
      {
        error: error?.error || error?.message || "Failed to start AutoClaw bulk import",
        ...(Array.isArray(error?.invalidLines) ? { invalidLines: error.invalidLines } : {}),
      },
      { status }
    );
  }
}

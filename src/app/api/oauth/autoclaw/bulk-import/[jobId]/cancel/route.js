import { NextResponse } from "next/server";
import { getAutoclawBulkImportManager } from "@/lib/oauth/services/autoclawBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getAutoclawBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}

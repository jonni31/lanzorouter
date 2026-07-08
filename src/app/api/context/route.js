import { NextResponse } from "next/server";
import { listContextFiles, createContextFile } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const files = await listContextFiles();
    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body?.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const file = await createContextFile({
      name,
      content: body?.content || "",
      enabled: body?.enabled !== false,
      priority: Number(body?.priority) || 0,
    });
    return NextResponse.json({ file });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

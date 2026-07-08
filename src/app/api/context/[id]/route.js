import { NextResponse } from "next/server";
import { getContextFile, updateContextFile, deleteContextFile } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getContextFile(id);
    if (!existing) {
      return NextResponse.json({ error: "Context file not found" }, { status: 404 });
    }
    const body = await request.json();
    const updates = {};
    if (body?.name !== undefined) updates.name = String(body.name);
    if (body?.content !== undefined) updates.content = String(body.content);
    if (body?.enabled !== undefined) updates.enabled = !!body.enabled;
    if (body?.priority !== undefined) updates.priority = Number(body.priority) || 0;
    const file = await updateContextFile(id, updates);
    return NextResponse.json({ file });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    await deleteContextFile(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createContextFilesBulk } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Bulk upload: body = { files: [{ name, content }, ...] }
// All inserted DISABLED so a large upload doesn't inject on every request
// until the user explicitly enables the ones they want.
export async function POST(request) {
  try {
    const body = await request.json();
    const files = Array.isArray(body?.files) ? body.files : [];
    const valid = files
      .map((f) => ({ name: String(f?.name || "").trim(), content: String(f?.content || "") }))
      .filter((f) => f.name);
    if (!valid.length) {
      return NextResponse.json({ error: "No valid files provided" }, { status: 400 });
    }
    const created = await createContextFilesBulk(valid);
    return NextResponse.json({ created: created.length, files: created });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

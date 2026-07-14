import { NextResponse } from "next/server";

// Restart app: exit the process so the process manager (pm2) respawns it.
export async function POST() {
  const response = NextResponse.json({ success: true, message: "Restarting..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}

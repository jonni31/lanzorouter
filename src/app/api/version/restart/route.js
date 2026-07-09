import { NextResponse } from "next/server";

// Restart the router process.
// PM2 will detect the exit and auto-restart the process.
export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: "Restarting router...",
  });

  // Exit after response is sent — PM2 auto-restarts
  setTimeout(() => process.exit(0), 500);

  return response;
}

import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";

const ALLOWED_PROVIDERS = new Set(["kiro-free", "kiro-paid"]);

function looksPaidAccount(email = "") {
  const e = String(email || "").toLowerCase();
  // Kiro Pro / Kiro Plus seats are paid — never land these on kiro-free.
  return e.includes("kiropro") || e.includes("kiroplus") || e.includes("kiro-pro") || e.includes("kiro-plus");
}

/**
 * POST /api/oauth/kiro/import-cli-proxy
 * Import Kiro CLIProxyAPI auth JSON for Microsoft external_idp accounts.
 *
 * Body:
 * - cliProxyAuth | auth | json: CLIProxyAPI auth object
 * - provider: "kiro-paid" | "kiro-free" (optional)
 *   Default: kiro-paid for kiropro/kiroplus emails, else kiro-free
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const rawAuth = body?.cliProxyAuth ?? body?.auth ?? body?.json ?? body;
    const tokenData = normalizeKiroExternalIdpAuth(rawAuth);

    const requested = typeof body?.provider === "string" ? body.provider.trim() : "";
    let provider = requested || (looksPaidAccount(tokenData.email) ? "kiro-paid" : "kiro-free");
    if (!ALLOWED_PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: `Invalid provider '${provider}'. Use kiro-paid or kiro-free.` },
        { status: 400 }
      );
    }

    const connection = await createProviderConnection({
      provider,
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
      email: tokenData.email || null,
      providerSpecificData: tokenData.providerSpecificData,
      testStatus: "active",
      isActive: true,
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "CLIProxyAPI import failed" },
      { status: 400 }
    );
  }
}

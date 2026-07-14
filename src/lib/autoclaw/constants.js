import { createHash } from "crypto";
import { randomUUID } from "crypto";

// AutoClaw (autoclaw.z.ai by Z.ai / Zhipu AI) constants. These mirror the
// public web app's client credentials — APP_KEY is embedded in the browser
// bundle, so it is not a secret we own, but we keep it in one place so the
// executor, bulk-import manager, and balance fetcher all sign the same way.
export const AUTOCLAW_APP_ID = "100003";
export const AUTOCLAW_APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
export const AUTOCLAW_BASE_URL = "https://autoglm-api.autoglm.ai";
export const AUTOCLAW_PROXY_URL = `${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw`;
export const AUTOCLAW_OAUTH_URL_ENDPOINT = `${AUTOCLAW_BASE_URL}/userapi/overseasv1/google-oauth-url`;
export const AUTOCLAW_REDIRECT_URI = `${AUTOCLAW_BASE_URL}/userapi/oauth/google/callback`;
export const AUTOCLAW_REFRESH_ENDPOINT = `${AUTOCLAW_BASE_URL}/userapi/v1/refresh`;
export const AUTOCLAW_WALLET_ENDPOINT = `${AUTOCLAW_BASE_URL}/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw`;
export const AUTOCLAW_VERSION = "1.10.0";

// AutoClaw selects the model via the X-Request-Model header, not the body's
// `model` field (which is a dummy). id = X-Request-Model value.
export const AUTOCLAW_MODELS = [
  { id: "openrouter_glm-5.2", name: "GLM-5.2" },
  { id: "zai_glm-5-turbo", name: "GLM-5-Turbo" },
  { id: "zai_auto", name: "DeepSeek-V4-Pro (Auto)" },
];

// x-auth-sign = md5(f"{APP_ID}&{timestamp}&{APP_KEY}")
export function generateAutoClawSign(timestamp) {
  const raw = `${AUTOCLAW_APP_ID}&${timestamp}&${AUTOCLAW_APP_KEY}`;
  return createHash("md5").update(raw).digest("hex");
}

// Base signed headers shared by the OAuth-url, wallet, and chat calls.
export function buildAutoClawAuthHeaders(extra = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    accept: "*/*",
    "content-type": "application/json",
    origin: "https://autoclaw.z.ai",
    referer: "https://autoclaw.z.ai/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-auth-appid": AUTOCLAW_APP_ID,
    "x-auth-timestamp": ts,
    "x-auth-sign": generateAutoClawSign(ts),
    "x-product": "autoclaw",
    "x-version": AUTOCLAW_VERSION,
    "x-tm": "web",
    "x-channel": "official",
    "x-client-type": "web",
    "x-trace-id": randomUUID(),
    "x-lang": "zh-CN",
    ...extra,
  };
}

// Wallet/asset endpoints authenticate via `authorization: Bearer <token>`
// (unlike chat, which uses X-Authorization with the RAW token). This helper
// normalizes the token (strips any existing "Bearer ") and re-applies it so
// the balance/quota calls always send the correct shape.
export function buildAutoClawWalletHeaders(accessToken) {
  const raw = String(accessToken || "").replace(/^Bearer\s+/i, "");
  return buildAutoClawAuthHeaders({ authorization: `Bearer ${raw}` });
}

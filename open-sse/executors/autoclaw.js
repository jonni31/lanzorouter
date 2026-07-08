/**
 * AutoClawExecutor — AutoClaw (autoclaw.z.ai by Z.ai) is an OpenAI-compatible
 * chat proxy, but with two twists:
 *   - The model is selected via the `X-Request-Model` header, NOT the body's
 *     `model` field (which is sent as a dummy "x").
 *   - Auth uses `X-Authorization: <accessToken>` plus signed x-auth-* headers
 *     (MD5 of appId&timestamp&appKey), not a plain Bearer token.
 * The upstream SSE is already plain OpenAI format, so we pass it through.
 */

import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  AUTOCLAW_PROXY_URL,
  AUTOCLAW_REFRESH_ENDPOINT,
  AUTOCLAW_APP_ID,
  AUTOCLAW_VERSION,
  generateAutoClawSign,
  buildAutoClawAuthHeaders,
} from "@/lib/autoclaw/constants.js";

export class AutoClawExecutor extends BaseExecutor {
  constructor() {
    super("autoclaw", PROVIDERS.autoclaw);
  }

  buildUrl() {
    return `${AUTOCLAW_PROXY_URL}/chat/completions`;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();

    if (!credentials?.accessToken) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "autoclaw credential is missing accessToken; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const requestModel = String(model || "").replace(/^autoclaw\//, "");
    // AutoClaw's X-Authorization expects the raw JWT. Tokens captured during
    // bulk register may be stored with a "Bearer " prefix — strip it so the
    // header is always the bare token.
    const rawToken = String(credentials.accessToken).replace(/^Bearer\s+/i, "");
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = {
      "Content-Type": "application/json",
      "X-Authorization": rawToken,
      "X-Request-Id": randomUUID(),
      "X-Request-Model": requestModel,
      "X-Auth-Appid": AUTOCLAW_APP_ID,
      "X-Auth-Timestamp": ts,
      "X-Auth-Sign": generateAutoClawSign(ts),
      "X-Product": "autoclaw",
      "X-Version": AUTOCLAW_VERSION,
      "X-Tm": "web",
      "X-Trace-Id": randomUUID(),
      Accept: "text/event-stream",
    };

    // AutoClaw picks the model from the header; the body `model` is a dummy.
    const payload = {
      model: "x",
      messages: Array.isArray(body?.messages) ? body.messages : [],
      stream: stream !== false,
      temperature: typeof body?.temperature === "number" ? body.temperature : 0.7,
    };
    if (Array.isArray(body?.tools)) payload.tools = body.tools;
    if (body?.tool_choice !== undefined) payload.tool_choice = body.tool_choice;
    if (typeof body?.max_tokens === "number") payload.max_tokens = body.max_tokens;

    let response;
    try {
      response = await proxyAwareFetch(
        url,
        { method: "POST", headers, body: JSON.stringify(payload), signal },
        proxyOptions,
      );
    } catch (error) {
      throw error;
    }

    // Upstream is plain OpenAI SSE — pass through unchanged.
    return { response, url, headers, transformedBody: payload };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    try {
      const response = await proxyAwareFetch(
        AUTOCLAW_REFRESH_ENDPOINT,
        {
          method: "POST",
          headers: buildAutoClawAuthHeaders({ authorization: String(credentials.accessToken || "").replace(/^Bearer\s+/i, "") }),
          body: JSON.stringify({ refresh_token: credentials.refreshToken }),
        },
        proxyOptions,
      );
      if (!response.ok) return null;
      const payload = await response.json();
      const data = payload?.data || payload;
      const accessToken = data?.access_token || data?.accessToken;
      if (!accessToken) return null;
      log?.info?.("TOKEN", "autoclaw refreshed");
      return {
        accessToken,
        refreshToken: data?.refresh_token || data?.refreshToken || credentials.refreshToken,
        expiresIn: 24 * 60 * 60,
      };
    } catch (error) {
      log?.error?.("TOKEN", `autoclaw refresh error: ${error.message}`);
      return null;
    }
  }
}

export default AutoClawExecutor;

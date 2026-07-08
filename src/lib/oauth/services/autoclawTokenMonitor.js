// AutoClaw captures its OWN access/refresh tokens from a network RESPONSE body
// after Google login (unlike the antigravity flow which reads a ?code= from a
// redirect URL). This monitor hooks page.on("response") across the context and
// every popup page, resolving { accessToken, refreshToken } as soon as a
// matching AutoClaw auth response arrives. Structure mirrors
// createGenericCallbackMonitor in kiroGoogleAutomation.js (multi-page bind +
// cleanup + timeout).

const DEFAULT_TOKEN_TIMEOUT_MS = 3 * 60_000;

// Response URLs that carry AutoClaw's tokens.
const TOKEN_URL_MARKERS = [
  "/userapi/overseasv1/google-oauth-login",
  "/userapi/v1/refresh",
  "/userapi/overseasv1/refresh",
];

function urlLooksLikeTokenResponse(url) {
  if (!url) return false;
  return TOKEN_URL_MARKERS.some((marker) => url.includes(marker));
}

function extractTokens(body) {
  if (!body || typeof body !== "object") return null;
  // AutoClaw wraps success as { code: 0, data: { access_token, refresh_token } }
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) return null;
  // Store the raw JWT — X-Authorization for chat expects it without "Bearer ".
  return {
    accessToken: String(accessToken).replace(/^Bearer\s+/i, ""),
    refreshToken: String(data.refresh_token || data.refreshToken || "").replace(/^Bearer\s+/i, ""),
  };
}

export function createAutoClawTokenMonitor(context, page, { timeoutMs = DEFAULT_TOKEN_TIMEOUT_MS } = {}) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  const trackedPages = new Set();
  const contextCleanups = new Map();
  const timeoutHandle = setTimeout(() => {
    settle(null, new Error("Timed out waiting for AutoClaw tokens"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    for (const fns of contextCleanups.values()) {
      for (const fn of fns) {
        try { fn(); } catch {}
      }
    }
    contextCleanups.clear();
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  async function inspectResponse(response) {
    if (settled || !response) return;
    let url = "";
    try { url = response.url() || ""; } catch { return; }
    if (!urlLooksLikeTokenResponse(url)) return;
    let body;
    try {
      body = await response.json();
    } catch {
      return;
    }
    const tokens = extractTokens(body);
    if (tokens) settle(tokens);
  }

  function registerPage(trackedPage, ownerCleanups) {
    if (!trackedPage || trackedPages.has(trackedPage)) return;
    trackedPages.add(trackedPage);

    const onResponse = (response) => { void inspectResponse(response); };
    trackedPage.on("response", onResponse);
    ownerCleanups.push(() => {
      trackedPage.off("response", onResponse);
    });
  }

  function bind(ctx, pg) {
    if (settled) return;
    if (contextCleanups.has(ctx)) return;
    const cleanups = [];
    contextCleanups.set(ctx, cleanups);
    const onPage = (newPage) => registerPage(newPage, cleanups);
    ctx.on("page", onPage);
    cleanups.push(() => ctx.off("page", onPage));
    if (pg) registerPage(pg, cleanups);
  }

  bind(context, page);
  promise.rebind = ({ context: newContext, page: newPage } = {}) => {
    if (newContext) bind(newContext, newPage);
  };

  return promise;
}

// Fallback: after the page has landed on autoclaw, tokens may only live in
// localStorage. Scan for JWT-looking values (mirrors the Python reference).
export async function readAutoClawTokensFromStorage(page) {
  if (!page) return null;
  let storage;
  try {
    storage = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && (val.includes("eyJ") || key.toLowerCase().includes("token"))) {
          out[key] = val;
        }
      }
      return out;
    });
  } catch {
    return null;
  }
  if (!storage) return null;

  let accessToken = "";
  let refreshToken = "";
  for (const [key, val] of Object.entries(storage)) {
    const cleaned = String(val).replace(/^Bearer\s+/i, "");
    if (!cleaned.startsWith("eyJ")) continue;
    if (key.toLowerCase().includes("refresh")) {
      refreshToken = cleaned;
    } else if (!accessToken) {
      accessToken = cleaned;
    }
  }
  if (!accessToken) return null;
  return { accessToken, refreshToken };
}

import { randomUUID } from "crypto";
import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";
import {
  createAutoClawTokenMonitor,
  readAutoClawTokensFromStorage,
} from "./autoclawTokenMonitor.js";
import { proxyAwareFetch } from "../../../../open-sse/utils/proxyFetch.js";
import {
  AUTOCLAW_OAUTH_URL_ENDPOINT,
  AUTOCLAW_REDIRECT_URI,
  AUTOCLAW_WALLET_ENDPOINT,
  buildAutoClawAuthHeaders,
  buildAutoClawWalletHeaders,
} from "../../autoclaw/constants.js";

const AUTOCLAW_PROVIDER_ID = "autoclaw";
const AUTOCLAW_LABEL = "AutoClaw";
const AUTOCLAW_TOKEN_TIMEOUT_MS = 3 * 60_000;

function proxyOptionsFor(account) {
  if (!account?.proxyUrl) return null;
  return { enabled: true, url: account.proxyUrl };
}

// Ask AutoClaw's API to mint the Google OAuth URL for this device.
async function fetchAutoClawOAuthUrl(deviceId, proxyOptions) {
  const response = await proxyAwareFetch(
    AUTOCLAW_OAUTH_URL_ENDPOINT,
    {
      method: "POST",
      headers: buildAutoClawAuthHeaders(),
      body: JSON.stringify({
        device_id: deviceId,
        source_id: "web",
        navigate_uri: AUTOCLAW_REDIRECT_URI,
        client_type: "web",
      }),
    },
    proxyOptions,
  );
  if (!response.ok) {
    throw new Error(`AutoClaw oauth-url request failed (HTTP ${response.status})`);
  }
  const data = await response.json();
  if (data?.code !== 0 || !data?.data?.oauth_url) {
    throw new Error(`AutoClaw oauth-url response invalid: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { oauthUrl: data.data.oauth_url, state: data.data.state || "" };
}

async function fetchAutoClawBalance(accessToken, proxyOptions) {
  try {
    const response = await proxyAwareFetch(
      AUTOCLAW_WALLET_ENDPOINT,
      { method: "GET", headers: buildAutoClawWalletHeaders(accessToken) },
      proxyOptions,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.code === 0) {
      return data.data?.total_balance ?? null;
    }
  } catch {
    /* balance is best-effort */
  }
  return null;
}

async function defaultSaveAutoClawConnection({ tokens, email, deviceId, balance }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    authMethod: "oauth",
    deviceId: deviceId || "",
    loginEmail: email,
    balance: balance ?? null,
    automation: "gsuite-bulk",
  };

  const connectionData = {
    provider: AUTOCLAW_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    displayName: email.split("@")[0],
    providerSpecificData,
    // AutoClaw access tokens expire in ~24h.
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({ engine: job?.engine || "chromium" });
}

class AutoClawBulkImportManager extends KiroBulkImportManager {
  constructor({
    saveConnection = defaultSaveAutoClawConnection,
    browserLauncher = defaultBrowserLauncher,
    storageName = "autoclaw-bulk-import",
  } = {}) {
    super({ browserLauncher, storageName });
    this.saveConnection = saveConnection;
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser, account.proxyUrl);
    account.runtimeSession = { context, page };

    const deviceId = randomUUID();
    const proxyOptions = proxyOptionsFor(account);

    let oauthUrl;
    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} requesting AutoClaw OAuth URL`);
      await this.persistJobSnapshot(job, { forcePreview: true });
      ({ oauthUrl } = await fetchAutoClawOAuthUrl(deviceId, proxyOptions));
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: `Failed to get AutoClaw OAuth URL: ${error.message}`,
        step: "failed",
        message: error.message,
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }

    const tokenPromise = createAutoClawTokenMonitor(context, page, {
      timeoutMs: AUTOCLAW_TOKEN_TIMEOUT_MS,
    });

    try {
      const automationResult = await runGoogleAccountAutomation({
        page,
        authUrl: oauthUrl,
        email: account.email,
        password: account.password,
        successPromise: tokenPromise,
        shortTimeoutMs: AUTOCLAW_TOKEN_TIMEOUT_MS,
        serviceLabel: AUTOCLAW_LABEL,
        openingStep: "opening_autoclaw_login",
        openingMessage: "Opening AutoClaw Google OAuth page",
        successStep: "autoclaw_tokens_received",
        successMessage: "AutoClaw tokens intercepted",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        const tokens = {
          accessToken: automationResult.accessToken,
          refreshToken: automationResult.refreshToken || "",
        };
        if (!tokens.accessToken) {
          throw new Error("AutoClaw automation succeeded but no access token captured");
        }
        await this.finishSuccess(job, account, tokens, deviceId, proxyOptions);
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = { context, page, opened: false, openedAt: null };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runAutoClawManualFollowup(job, account, context, page, tokenPromise, deviceId, proxyOptions);
        return;
      }

      const terminalStatus = automationResult.status?.startsWith("failed") ? automationResult.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "AutoClaw Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "AutoClaw Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected AutoClaw bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected AutoClaw bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  async finishSuccess(job, account, tokens, deviceId, proxyOptions) {
    this.setAccountStep(account, "fetching_balance", "Fetching AutoClaw balance");
    await this.persistJobSnapshot(job, { forcePreview: true });
    const balance = await fetchAutoClawBalance(tokens.accessToken, proxyOptions);

    this.setAccountStep(account, "saving_connection", "Saving AutoClaw connection to database");
    await this.persistJobSnapshot(job, { forcePreview: true });
    const { connection } = await this.saveConnection({
      tokens,
      email: account.email,
      deviceId,
      balance,
    });

    const balanceLabel = balance != null ? ` (${balance} pts)` : "";
    this.finalizeAccount(account, "success", {
      connectionId: connection.id,
      step: "connection_saved",
      message: `AutoClaw connection saved successfully${balanceLabel}`,
    });
  }

  async runAutoClawManualFollowup(job, account, context, page, tokenPromise, deviceId, proxyOptions) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        let tokens = null;
        try {
          tokens = await tokenPromise;
        } catch {
          // Monitor timed out — try the localStorage fallback before giving up.
          tokens = await readAutoClawTokensFromStorage(account.manualSession?.page || page);
        }
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }
        if (!tokens?.accessToken) {
          throw new Error("Manual flow finished but no AutoClaw token captured");
        }
        await this.finishSuccess(job, account, tokens, deviceId, proxyOptions);
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed", {
            error: error.message || "Manual assist flow failed.",
            step: "failed",
            message: error.message || "Manual assist flow failed.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }
}

function getSingletonStore() {
  if (!globalThis.__autoclawBulkImportSingleton) {
    globalThis.__autoclawBulkImportSingleton = {
      manager: new AutoClawBulkImportManager(),
    };
  }
  return globalThis.__autoclawBulkImportSingleton;
}

export function getAutoclawBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  AutoClawBulkImportManager,
  buildLookupResponse,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
};

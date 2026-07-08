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
import {
  runGoogleAccountAutomation,
  createGenericCallbackMonitor,
} from "./kiroGoogleAutomation.js";
import { generateAuthData, exchangeTokens } from "../providers.js";

const ANTIGRAVITY_PROVIDER_ID = "antigravity";
const ANTIGRAVITY_LABEL = "Antigravity";
const ANTIGRAVITY_CALLBACK_TIMEOUT_MS = 3 * 60_000;

// Antigravity uses a Google loopback redirect on the app's own port (same as
// the single-OAuth flow in antigravity.js). Google desktop clients accept any
// localhost port, but authUrl and token exchange MUST use the same value.
function getRedirectUri() {
  const port = process.env.PORT || "1997";
  return `http://localhost:${port}/callback`;
}

async function defaultSaveAntigravityConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    authMethod: "oauth",
    projectId: tokens.projectId || "",
    loginEmail: email,
    automation: "gsuite-bulk",
  };

  const connectionData = {
    provider: ANTIGRAVITY_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    displayName: tokens.displayName || email.split("@")[0],
    providerSpecificData,
    expiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({ engine: job?.engine || "chromium" });
}

class AntigravityBulkImportManager extends KiroBulkImportManager {
  constructor({
    saveConnection = defaultSaveAntigravityConnection,
    browserLauncher = defaultBrowserLauncher,
    storageName = "antigravity-bulk-import",
  } = {}) {
    super({
      browserLauncher,
      storageName,
    });
    this.saveConnection = saveConnection;
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser, account.proxyUrl);
    account.runtimeSession = { context, page };

    const redirectUri = getRedirectUri();
    const state = randomUUID();
    let authData;
    try {
      authData = await generateAuthData(ANTIGRAVITY_PROVIDER_ID, redirectUri);
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: `Failed to build Antigravity auth URL: ${error.message}`,
        step: "failed",
        message: error.message,
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }

    // authData.state from generateAuthData drives the auth URL; reuse it for exchange.
    const authState = authData.state || state;
    const callbackPromise = createGenericCallbackMonitor(context, page, {
      prefix: redirectUri,
      timeoutMs: ANTIGRAVITY_CALLBACK_TIMEOUT_MS,
    });

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing Antigravity Google OAuth`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const automationResult = await runGoogleAccountAutomation({
        page,
        authUrl: authData.authUrl,
        email: account.email,
        password: account.password,
        successPromise: callbackPromise,
        shortTimeoutMs: ANTIGRAVITY_CALLBACK_TIMEOUT_MS,
        serviceLabel: ANTIGRAVITY_LABEL,
        openingStep: "opening_antigravity_login",
        openingMessage: "Opening Antigravity Google OAuth page",
        successStep: "antigravity_callback_received",
        successMessage: "Antigravity OAuth callback received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        const code = automationResult.code;
        if (!code) {
          throw new Error("OAuth callback captured but no authorization code present");
        }

        this.setAccountStep(account, "exchanging_token", "Exchanging authorization code for tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const tokens = await exchangeTokens(
          ANTIGRAVITY_PROVIDER_ID,
          code,
          redirectUri,
          authData.codeVerifier || null,
          automationResult.state || authState,
        );

        this.setAccountStep(account, "saving_connection", "Saving Antigravity connection to database");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const { connection } = await this.saveConnection({
          tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || "",
            projectId: tokens.projectId || "",
            expiresIn: tokens.expiresIn || null,
            displayName: tokens.email || "",
          },
          email: tokens.email || account.email,
        });

        const projectLabel = tokens.projectId ? ` (project ${tokens.projectId})` : "";
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: `Antigravity connection saved successfully${projectLabel}`,
        });
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

        await this.runAntigravityManualFollowup(job, account, workerId, context, callbackPromise, redirectUri, authData, authState);
        return;
      }

      const terminalStatus = automationResult.status?.startsWith("failed") ? automationResult.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Antigravity Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Antigravity Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Antigravity bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Antigravity bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  async runAntigravityManualFollowup(job, account, workerId, context, callbackPromise, redirectUri, authData, authState) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const result = await callbackPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        const code = result?.code;
        if (!code) throw new Error("Manual flow finished but no authorization code captured");

        this.setAccountStep(account, "exchanging_token", "Exchanging authorization code for tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const tokens = await exchangeTokens(
          ANTIGRAVITY_PROVIDER_ID,
          code,
          redirectUri,
          authData.codeVerifier || null,
          result.state || authState,
        );

        this.setAccountStep(account, "saving_connection", "Saving Antigravity connection");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const { connection } = await this.saveConnection({
          tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || "",
            projectId: tokens.projectId || "",
            expiresIn: tokens.expiresIn || null,
            displayName: tokens.email || "",
          },
          email: tokens.email || account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Antigravity connection saved successfully",
        });
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
  if (!globalThis.__antigravityBulkImportSingleton) {
    globalThis.__antigravityBulkImportSingleton = {
      manager: new AntigravityBulkImportManager(),
    };
  }
  return globalThis.__antigravityBulkImportSingleton;
}

export function getAntigravityBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  AntigravityBulkImportManager,
  buildLookupResponse,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
};

import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

const SUPPORTED_ENGINES = new Set(["chromium", "camoufox"]);
export const DEFAULT_BULK_IMPORT_ENGINE = "chromium";

export function normalizeBulkImportEngine(value) {
  if (typeof value !== "string") return DEFAULT_BULK_IMPORT_ENGINE;
  const lower = value.trim().toLowerCase();
  return SUPPORTED_ENGINES.has(lower) ? lower : DEFAULT_BULK_IMPORT_ENGINE;
}

function loadRuntimeHelper(name) {
  try {
    return requireFromHere(`../../../../cli/hooks/${name}`);
  } catch {
    return null;
  }
}

async function importPlaywright() {
  const playwright = await import("playwright");
  return playwright.chromium ?? playwright.default?.chromium ?? null;
}

const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      plugins.length = 3;
      return plugins;
    }
  });
  const _origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : _origQuery.call(window.navigator.permissions, parameters);
  if (window.chrome) {
    if (!window.chrome.runtime) window.chrome.runtime = {};
    window.chrome.runtime.connect = window.chrome.runtime.connect || function() {};
    window.chrome.runtime.sendMessage = window.chrome.runtime.sendMessage || function() {};
  } else {
    window.chrome = { runtime: { connect: function() {}, sendMessage: function() {} } };
  }
  const _origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return _origGetParameter.call(this, parameter);
  };
`;

function getStealthUserAgent(browserVersion) {
  const ver = browserVersion || "131.0.0.0";
  // Match the UA platform string to the actual OS so Google doesn't flag a
  // mismatch between the User-Agent header and navigator.platform / other
  // client-side signals that leak the real OS.
  const platform = typeof process !== "undefined" ? process.platform : "linux";
  if (platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  if (platform === "win32") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  // Linux (the VPS default)
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

function wrapBrowserWithStealth(browser) {
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async function (options = {}) {
    // Fix HeadlessChrome in User-Agent — Google detects this server-side
    if (!options.userAgent) {
      const ver = browser.version ? browser.version() : "131.0.0.0";
      options.userAgent = getStealthUserAgent(ver);
    }
    const ctx = await origNewContext(options);
    await ctx.addInitScript(STEALTH_INIT_SCRIPT);
    return ctx;
  };
  return browser;
}

async function launchChromium({ proxyUrl } = {}) {
  let chromium = null;
  let importErr = null;
  try {
    chromium = await importPlaywright();
  } catch (err) {
    importErr = err;
  }

  if (!chromium) {
    const runtime = loadRuntimeHelper("playwrightRuntime");
    if (runtime?.ensurePlaywrightRuntime) {
      const ready = runtime.ensurePlaywrightRuntime({ silent: false });
      if (ready.ok) {
        try {
          chromium = await importPlaywright();
        } catch (err) {
          importErr = err;
        }
        if (!chromium) {
          const mod = ready.module || runtime.loadPlaywrightModule?.();
          chromium = mod?.chromium ?? null;
        }
      } else if (ready.error) {
        if (importErr) ready.error.cause = importErr;
        throw ready.error;
      }
    }
  }

  if (!chromium) {
    const friendly = new Error(
      `Playwright is not installed. Run "npm install -g playwright && npx playwright install chromium" or restart the bulk import to auto-install.`
    );
    friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
    friendly.cause = importErr;
    throw friendly;
  }

  const options = {
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
      "--disable-infobars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-ipc-flooding-protection",
      "--password-store=basic",
      "--use-mock-keychain",
      "--window-size=1920,1080",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  if (proxyUrl) options.proxy = { server: proxyUrl };

  const browser = await chromium.launch(options);
  return wrapBrowserWithStealth(browser);
}

async function launchCamoufox({ proxyUrl } = {}) {
  const runtime = loadRuntimeHelper("camoufoxRuntime");
  if (!runtime?.ensureCamoufoxRuntime) {
    const err = new Error(
      `Camoufox runtime helper missing. Reinstall z‍evairouter or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_RUNTIME_HELPER_MISSING";
    throw err;
  }
  const ready = runtime.ensureCamoufoxRuntime({ silent: false });
  if (!ready.ok && ready.error) throw ready.error;

  const camoufox = ready.module || runtime.loadCamoufoxModule?.();
  if (!camoufox?.launchOptions) {
    const err = new Error(
      `camoufox-js loaded but does not expose launchOptions(); reinstall the package or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_API_MISMATCH";
    throw err;
  }

  let firefox;
  try {
    const pwCore = await import("playwright-core");
    firefox = pwCore.firefox;
  } catch {
    try {
      const pw = await import("playwright");
      firefox = pw.firefox;
    } catch (err) {
      const friendly = new Error(
        `Playwright is required to drive Camoufox. Run "npm install -g playwright" or pick the Chromium engine.`
      );
      friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
      friendly.cause = err;
      throw friendly;
    }
  }

  const camoufoxOptions = await camoufox.launchOptions({ headless: true });
  const launchOptions = { ...camoufoxOptions };
  if (proxyUrl) launchOptions.proxy = { server: proxyUrl };

  return firefox.launch(launchOptions);
}

export async function launchBulkImportBrowser({ engine = DEFAULT_BULK_IMPORT_ENGINE, proxyUrl } = {}) {
  const normalized = normalizeBulkImportEngine(engine);
  if (normalized === "camoufox") {
    return launchCamoufox({ proxyUrl });
  }
  return launchChromium({ proxyUrl });
}

export function makeBrowserLauncher({ engine, proxyUrl } = {}) {
  return () => launchBulkImportBrowser({ engine, proxyUrl });
}

// Ensure camoufox-js (optional stealth Firefox engine) is installed AND its
// browser binary is downloaded. The package is in optionalDependencies, so
// `npm install -g zevairouter` may legitimately ship without it (e.g. when npm
// skipped optional install on a constrained network). When the user picks
// Camoufox in the bulk-import modal we install lazily \u2014 same shape as the
// sqlite/playwright runtime helpers \u2014 instead of failing the worker.
const { spawnSync } = require("child_process");
const { createRequire } = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runNpmInstall, getRuntimeDir, getRuntimeNodeModules } = require("./sqliteRuntime");

const CAMOUFOX_PACKAGE = "camoufox-js";
const CAMOUFOX_VERSION = "^0.11.0";

// This helper is reached through webpack-bundled server code, which rewrites
// bare `require(...)` into its own module registry — so `require("camoufox-js")`
// throws MODULE_NOT_FOUND even though the package is on disk. __non_webpack_require__
// is left untouched by webpack and resolves to Node's real require at runtime;
// outside webpack (plain CLI) it's undefined, so we fall back to require.
const nodeRequire =
  typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require;

// A require() anchored at the runtime node_modules dir. createRequire is real
// Node resolution (never touched by webpack), so it reliably loads the lazily
// installed camoufox-js from ~/.zevai/runtime regardless of the process cwd or
// the standalone bundle's module registry.
function getRuntimeRequire() {
  try {
    const anchor = path.join(getRuntimeDir(), "noop.js");
    return createRequire(anchor);
  } catch {
    return null;
  }
}

let cachedReady = null;

function tryRequireCamoufox() {
  // 1) Direct absolute-path resolution via a runtime-anchored createRequire —
  //    the most robust path (works from any cwd, bypasses webpack's registry).
  try {
    const rreq = getRuntimeRequire();
    const candidate = path.join(getRuntimeNodeModules(), CAMOUFOX_PACKAGE);
    if (rreq && fs.existsSync(path.join(candidate, "package.json"))) {
      return rreq(candidate);
    }
  } catch {}
  // 2) Bare require (works when camoufox-js is globally resolvable, e.g. dev).
  try {
    return nodeRequire(CAMOUFOX_PACKAGE);
  } catch {}
  // 3) Last resort: bundler require against the absolute path.
  try {
    const candidate = path.join(getRuntimeNodeModules(), CAMOUFOX_PACKAGE);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return nodeRequire(candidate);
    }
  } catch {}
  return null;
}

function findCamoufoxCli() {
  const candidates = [];
  // camoufox-js ships its CLI entry as dist/__main__.js (there is no cli.js).
  const rel = ["dist", "__main__.js"];
  try {
    const pkgJson = nodeRequire.resolve(`${CAMOUFOX_PACKAGE}/package.json`);
    candidates.push(path.join(path.dirname(pkgJson), ...rel));
  } catch {}
  try {
    candidates.push(path.join(getRuntimeNodeModules(), CAMOUFOX_PACKAGE, ...rel));
  } catch {}
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getCamoufoxBinaryDir() {
  const homeDir = os.homedir();
  // Mirror camoufox-js's userCacheDir() exactly (dist/pkgman.js) so we look in
  // the same place it installs to, on every platform.
  if (process.platform === "win32") {
    return path.join(homeDir, "AppData", "Local", "camoufox", "camoufox", "Cache");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Caches", "camoufox");
  }
  return path.join(homeDir, ".cache", "camoufox");
}

// The launch binary camoufox-js resolves per OS (dist/pkgman.js LAUNCH_FILE),
// relative to the install dir. Linux is the primary target (Ubuntu VPS).
function getCamoufoxLaunchBinary() {
  const dir = getCamoufoxBinaryDir();
  if (process.platform === "win32") return path.join(dir, "camoufox.exe");
  if (process.platform === "darwin") return path.join(dir, "Camoufox.app", "Contents", "MacOS", "camoufox");
  return path.join(dir, "camoufox-bin");
}

function isCamoufoxBinaryAvailable() {
  try {
    return fs.existsSync(getCamoufoxLaunchBinary());
  } catch {
    return false;
  }
}

function ensureCamoufoxPackage({ silent = false } = {}) {
  const mod = tryRequireCamoufox();
  if (mod) return { ok: true, module: mod };

  if (!silent) console.log("\u23f3 Installing camoufox-js (first run, ~few MB)...");
  const installRes = runNpmInstall({
    cwd: getRuntimeDir(),
    pkgs: [`${CAMOUFOX_PACKAGE}@${CAMOUFOX_VERSION}`],
    extraArgs: ["--no-save"],
    timeout: 300_000,
  });

  if (!installRes.ok) {
    return {
      ok: false,
      reason: `npm install ${CAMOUFOX_PACKAGE} failed: ${installRes.stderr.split("\n").pop().slice(0, 200)}`,
    };
  }

  const installed = tryRequireCamoufox();
  if (!installed) {
    return { ok: false, reason: "camoufox-js installed but cannot be required" };
  }
  return { ok: true, module: installed };
}

function fetchCamoufoxBinary({ silent = false, timeout = 600_000 } = {}) {
  const cliPath = findCamoufoxCli();
  if (!cliPath) {
    return { ok: false, reason: "camoufox-js cli script not found after install" };
  }
  if (!silent) console.log("\u23f3 Downloading Camoufox browser binary (first run, ~150MB)...");
  const res = spawnSync(process.execPath, [cliPath, "fetch"], {
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout,
    encoding: "utf8",
  });
  if (res.status === 0) {
    if (!silent) console.log("\u2705 Camoufox browser ready");
    return { ok: true };
  }
  const stderr = String(res.stderr || "");
  let reason = "unknown error";
  if (/ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(stderr)) reason = "no internet connection";
  else if (/EACCES|EPERM/i.test(stderr)) reason = "permission denied";
  else if (/ENOSPC/i.test(stderr)) reason = "not enough disk space";
  else if (stderr.trim()) reason = stderr.trim().split(/\r?\n/).pop().slice(0, 200);
  return { ok: false, reason };
}

function findPlaywrightCli() {
  const candidates = [];
  for (const pkg of ["playwright", "playwright-core"]) {
    try {
      candidates.push(path.join(path.dirname(nodeRequire.resolve(`${pkg}/package.json`)), "cli.js"));
    } catch {}
    try {
      candidates.push(path.join(getRuntimeNodeModules(), pkg, "cli.js"));
    } catch {}
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Camoufox is a patched Firefox; on a fresh Linux host it fails to launch with
// "libgtk-3.so.0: cannot open shared object file" because the GUI/X libraries
// aren't present. `playwright install-deps firefox` apt-installs them. This is
// idempotent (no-op once satisfied) and only attempted on Linux as root, where
// apt is available without a sudo prompt. Non-fatal: a missing lib surfaces as
// a clear launch error later, and the user can run the command themselves.
function ensureLinuxBrowserDeps({ silent = false } = {}) {
  if (process.platform !== "linux") return { ok: true, skipped: "not-linux" };
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    if (!silent) console.log("\u2139 Skipping auto-install of Camoufox system libs (not root). If Camoufox fails to launch, run: npx playwright install-deps firefox");
    return { ok: true, skipped: "not-root" };
  }
  const cliPath = findPlaywrightCli();
  if (!cliPath) return { ok: true, skipped: "no-playwright-cli" };
  if (!silent) console.log("\u23f3 Installing Camoufox system libraries (Linux, first run)...");
  const res = spawnSync(process.execPath, [cliPath, "install-deps", "firefox"], {
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 300_000,
    encoding: "utf8",
  });
  if (res.status === 0) {
    if (!silent) console.log("\u2705 Camoufox system libraries ready");
    return { ok: true };
  }
  if (!silent) console.log("\u26a0 Could not auto-install system libs; if Camoufox fails to launch run: npx playwright install-deps firefox");
  return { ok: false, reason: String(res.stderr || "").trim().split(/\r?\n/).pop()?.slice(0, 200) };
}

function ensureCamoufoxRuntime({ silent = false } = {}) {
  if (cachedReady === true) return { ok: true };

  const pkg = ensureCamoufoxPackage({ silent });
  if (!pkg.ok) {
    cachedReady = false;
    const error = new Error(
      `Camoufox engine not available. ${pkg.reason}. ` +
      `Install manually with "npm install -g camoufox-js && npx camoufox-js fetch", then retry. ` +
      `You can also switch back to the Chromium engine in the bulk-import modal.`
    );
    error.code = "CAMOUFOX_PACKAGE_MISSING";
    return { ok: false, error };
  }

  if (!isCamoufoxBinaryAvailable()) {
    const fetched = fetchCamoufoxBinary({ silent });
    if (!fetched.ok) {
      cachedReady = false;
      const error = new Error(
        `Camoufox browser binary not downloaded. ${fetched.reason}. ` +
        `Run "npx camoufox-js fetch" manually, then retry. ` +
        `You can also switch back to the Chromium engine in the bulk-import modal.`
      );
      error.code = "CAMOUFOX_BINARY_MISSING";
      return { ok: false, error };
    }
  }

  // Ensure Linux GUI libraries are present (idempotent). Runs even when the
  // binary already existed — a host can have the binary but miss the libs (the
  // libgtk-3.so.0 launch failure). Non-fatal; we cache readiness regardless.
  ensureLinuxBrowserDeps({ silent });

  cachedReady = true;
  return { ok: true, module: pkg.module };
}

function loadCamoufoxModule() {
  return tryRequireCamoufox();
}

function resetCache() {
  cachedReady = null;
}

module.exports = {
  ensureCamoufoxRuntime,
  loadCamoufoxModule,
  isCamoufoxBinaryAvailable,
  resetCache,
};

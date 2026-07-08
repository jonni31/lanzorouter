// Ensure better-sqlite3 is installed in USER_DATA_DIR/runtime/node_modules
// (user-writable, avoids Windows EBUSY locks during npm i -g updates).
// sql.js is bundled in bin/app already; node:sqlite / bun:sqlite are built-in.
//
// NOTE: APP_NAME here MUST stay in sync with src/lib/dataDir.js (ESM). This
// CommonJS copy exists because cli/ can't import the ESM src/ module at
// runtime. Both resolve to ~/.zevai (or %APPDATA%/zevai on Windows).
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_NAME = "zevai";
const BETTER_SQLITE3_VERSION = "12.6.2";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), APP_NAME)
    : path.join(os.homedir(), `.${APP_NAME}`);
}

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), "node_modules");
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Minimal package.json so npm treats it as a project root
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "zevai-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable runtime deps for ZevaiRouter (better-sqlite3 native binary)",
    }, null, 2));
  }
  return dir;
}

function hasModule(name) {
  return fs.existsSync(path.join(getRuntimeNodeModules(), name, "package.json"));
}

function isBetterSqliteBinaryValid() {
  const binary = path.join(getRuntimeNodeModules(), "better-sqlite3", "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(binary)) return false;
  try {
    const fd = fs.openSync(binary, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (process.platform === "linux") return magic.startsWith("7f454c46");
    if (process.platform === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    if (process.platform === "win32") return magic.startsWith("4d5a");
    return true;
  } catch { return false; }
}

// Extract a short, user-friendly reason from npm stderr.
function summarizeNpmError(stderr = "") {
  const text = String(stderr);
  if (/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|getaddrinfo/i.test(text)) return "No internet connection or registry unreachable";
  if (/EACCES|EPERM|permission denied/i.test(text)) return "Permission denied (check folder permissions)";
  if (/ENOSPC|no space/i.test(text)) return "Not enough disk space";
  if (/node-gyp|gyp ERR|python|MSBuild|Visual Studio|Xcode/i.test(text)) return "Missing build tools (Xcode CLT / Python / VS Build Tools)";
  if (/ETARGET|version.*not found/i.test(text)) return "Package version not found on registry";
  const m = text.match(/npm ERR! (.+)/);
  if (m) return m[1].slice(0, 200);
  const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
  return lastLine ? lastLine.slice(0, 200) : "Unknown error";
}

function runNpmInstall({ cwd, pkgs, extraArgs = [], timeout = 180000 }) {
  // Use --save (NOT --no-save): the runtime dir hosts several lazily-installed
  // optional packages (better-sqlite3, camoufox-js, playwright, systray2). npm
  // v11 prunes anything NOT declared in package.json on every `npm install`, so
  // --no-save made each install wipe the previously-installed optional packages
  // (camoufox-js kept vanishing on restart). --save records each package as a
  // real dependency so npm treats it as legitimate and never prunes it.
  const filtered = extraArgs.filter((a) => a !== "--no-save");
  const args = ["install", ...pkgs, "--save", "--no-audit", "--no-fund", "--prefer-online", ...filtered];

  // Prefer running npm-cli.js with the SAME Node that's executing us. On hosts
  // where the default `npm`/`/usr/bin/node` is an old Node (e.g. v12), spawning
  // the `npm` shim re-execs under that old runtime and crashes. process.execPath
  // is the live (new) Node; pair it with its own npm-cli.js when resolvable.
  let command = process.platform === "win32" ? "npm.cmd" : "npm";
  let finalArgs = args;
  let useShell = process.platform === "win32";
  try {
    const npmCliPath = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    if (fs.existsSync(npmCliPath)) {
      command = process.execPath;
      finalArgs = [npmCliPath, ...args];
      useShell = false;
    }
  } catch { /* fall back to npm shim */ }

  const res = spawnSync(command, finalArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    shell: useShell,
    encoding: "utf8",
  });
  return { ok: res.status === 0, code: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
}

function npmInstall(pkgs, opts = {}) {
  const cwd = ensureRuntimeDir();
  const extra = opts.optional ? ["--no-save"] : [];
  if (!opts.silent) console.log("⏳ Installing SQLite engine (first run)...");
  const res = runNpmInstall({ cwd, pkgs, extraArgs: extra, timeout: opts.timeout || 180000 });
  if (!res.ok && !opts.silent) {
    const reason = summarizeNpmError(res.stderr);
    console.warn("⚠️  SQLite engine install failed — using fallback");
    console.warn(`   Reason: ${reason}`);
    console.warn(`   Retry:  cd "${cwd}" && npm install ${pkgs.join(" ")}`);
  }
  return res.ok;
}

// Public: ensure better-sqlite3 native module is installed in user-writable
// runtime dir. sql.js is bundled in bin/app already; node:sqlite is built-in.
// This is purely a *speed optimization* — app works without it via fallbacks.
function ensureSqliteRuntime({ silent = false } = {}) {
  ensureRuntimeDir();

  const needBetterSqlite = !hasModule("better-sqlite3") || !isBetterSqliteBinaryValid();
  if (!needBetterSqlite) {
    if (!silent) console.log("✅ SQLite engine ready");
    return { betterSqlite: true };
  }

  const ok = npmInstall([`better-sqlite3@${BETTER_SQLITE3_VERSION}`], { optional: true, silent });
  return {
    betterSqlite: ok && hasModule("better-sqlite3") && isBetterSqliteBinaryValid(),
  };
}

// Inject runtime + bundled node_modules into NODE_PATH so child Node processes
// resolve sql.js (bundled in bin/app/node_modules) and better-sqlite3 (runtime).
function buildEnvWithRuntime(baseEnv = process.env) {
  const runtimeNm = getRuntimeNodeModules();
  const bundledNm = path.join(__dirname, "..", "app", "node_modules");
  // Also check parent package node_modules (for npm global install where
  // cli/app/node_modules is not shipped — deps live in root node_modules)
  const parentNm = path.join(__dirname, "..", "..", "node_modules");
  const existing = baseEnv.NODE_PATH || "";
  const NODE_PATH = [runtimeNm, bundledNm, parentNm, existing].filter(Boolean).join(path.delimiter);
  return { ...baseEnv, NODE_PATH };
}

module.exports = {
  ensureSqliteRuntime,
  buildEnvWithRuntime,
  getRuntimeDir,
  getRuntimeNodeModules,
  runNpmInstall,
  summarizeNpmError,
};

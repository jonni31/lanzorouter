#!/usr/bin/env node

// Postinstall: warm-up runtime deps into ~/.zevai/runtime so the first
// `zevai` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const path = require("path");
const fs = require("fs");
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");
const { ensurePlaywrightRuntime, getRuntimeNodeModules: getRtNm } = require("./playwrightRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[zevai] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[zevai] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[zevai] tray runtime skipped: ${e.message}`);
}

try {
  const pw = ensurePlaywrightRuntime({ silent: false });
  if (pw.ok) {
    console.log("[zevai] Playwright + Chromium ready");
    // Next.js standalone server can only resolve playwright from cli/app/node_modules.
    // npm strips node_modules on publish, so we re-link after install.
    linkPlaywrightToStandalone();
  } else {
    console.warn(`[zevai] Playwright setup skipped: ${pw.error?.message || "unknown"}`);
  }
} catch (e) {
  console.warn(`[zevai] Playwright setup skipped: ${e.message}`);
}

function linkPlaywrightToStandalone() {
  try {
    const { getRuntimeNodeModules } = require("./sqliteRuntime");
    const runtimeNm = getRuntimeNodeModules();
    const standaloneNm = path.join(__dirname, "..", "app", "node_modules");
    if (!fs.existsSync(path.join(standaloneNm, "next"))) return; // no standalone build
    for (const pkg of ["playwright", "playwright-core"]) {
      const src = path.join(runtimeNm, pkg);
      const dest = path.join(standaloneNm, pkg);
      if (!fs.existsSync(path.join(src, "package.json"))) continue;
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    }
    console.log("[zevai] Playwright linked to standalone bundle");
  } catch (e) {
    // Non-fatal — automation will show manual install message
  }
}

process.exit(0);

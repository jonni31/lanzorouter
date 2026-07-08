import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Legacy data dirs from upstream forks. We auto-migrate contents into the new
// ~/.lanzo data dir on first run so existing accounts/connections are preserved.
// This module is intentionally self-contained (no imports from dataDir.js)
// because cli/ (CommonJS) and src/ (ESM) both need the same logic.
//
// Migration order: try ~/.zevai first (most recent), then ~/.9router (oldest).
const LEGACY_SOURCES = [
  { appName: "zevai", marker: ".migrated-from-zevai" },
  { appName: "9router", marker: ".migrated-from-9router" },
];

function legacyDir(appName) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appName);
  }
  return path.join(os.homedir(), `.${appName}`);
}

/**
 * One-time migration of legacy data dirs into the new ~/.lanzo data dir.
 * Tries ~/.zevai first, then ~/.9router. Copies recursively and leaves the
 * legacy dir intact as a backup. Idempotent via marker files.
 * Safe to call on every boot — no-ops once migrated or on fresh installs.
 *
 * @param {string} newDataDir - resolved new data dir (from dataDir.js getDataDir)
 */
export function migrateLegacyDataDir(newDataDir) {
  if (!newDataDir) return;
  if (process.env.DATA_DIR && process.env.DATA_DIR !== newDataDir) return;

  for (const { appName, marker: markerName } of LEGACY_SOURCES) {
    const markerPath = path.join(newDataDir, markerName);

    // Already migrated from this source — skip.
    if (fs.existsSync(markerPath)) continue;

    const srcDir = legacyDir(appName);
    if (!fs.existsSync(srcDir)) continue;

    // If new dir already has real content, don't clobber — just stamp marker.
    if (fs.existsSync(newDataDir)) {
      try {
        fs.mkdirSync(newDataDir, { recursive: true });
        fs.writeFileSync(markerPath, new Date().toISOString());
      } catch {}
      continue;
    }

    try {
      console.log(`[migrate] Copying legacy data ${srcDir} → ${newDataDir}`);
      fs.mkdirSync(path.dirname(newDataDir), { recursive: true });
      fs.cpSync(srcDir, newDataDir, { recursive: true });
      fs.writeFileSync(markerPath, new Date().toISOString());
      console.log(`[migrate] Done. Legacy data kept at ${srcDir} as backup.`);
      return; // Successfully migrated from one source — done.
    } catch (err) {
      console.warn(`[migrate] Failed to migrate ${srcDir} → ${newDataDir}: ${err.message}. Trying next source.`);
    }
  }
}

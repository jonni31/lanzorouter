import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Legacy data dir from the upstream 9router fork. We auto-migrate its contents
// into the new ~/.zevai data dir on first run so existing accounts/connections
// are preserved. This module is intentionally self-contained (no imports from
// dataDir.js) because cli/ (CommonJS) and src/ (ESM) both need the same logic.
const LEGACY_APP_NAME = "9router";
const MIGRATED_MARKER = ".migrated-from-9router";

function legacyDefaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), LEGACY_APP_NAME);
  }
  return path.join(os.homedir(), `.${LEGACY_APP_NAME}`);
}

/**
 * One-time migration of the legacy ~/.zevai data dir into the new data dir
 * (~/.zevai on macOS/Linux, %APPDATA%/zevai on Windows). Copies recursively
 * and leaves the legacy dir intact as a backup. Idempotent via a marker file.
 * Safe to call on every boot — no-ops once migrated or on fresh installs.
 *
 * @param {string} newDataDir - resolved new data dir (from dataDir.js getDataDir)
 */
export function migrateLegacyDataDir(newDataDir) {
  if (!newDataDir) return;

  // Already migrated, or user is explicitly using DATA_DIR env override that
  // points elsewhere — don't touch.
  const marker = path.join(newDataDir, MIGRATED_MARKER);
  if (fs.existsSync(marker)) return;
  if (process.env.DATA_DIR && process.env.DATA_DIR !== newDataDir) return;

  const legacyDir = legacyDefaultDir();
  if (!fs.existsSync(legacyDir)) return;

  // If new dir already has real content (e.g. user started fresh before
  // migration ran), don't clobber — just stamp the marker and move on.
  const newExists = fs.existsSync(newDataDir);
  if (newExists) {
    try {
      // Stamp marker so we don't keep checking; legacy dir left as backup.
      fs.mkdirSync(newDataDir, { recursive: true });
      fs.writeFileSync(marker, new Date().toISOString());
    } catch {}
    return;
  }

  try {
    console.log(`[migrate] Copying legacy data ${legacyDir} → ${newDataDir}`);
    fs.mkdirSync(path.dirname(newDataDir), { recursive: true });
    fs.cpSync(legacyDir, newDataDir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
    console.log(`[migrate] Done. Legacy data kept at ${legacyDir} as backup.`);
  } catch (err) {
    // Never crash the app over migration — fall back to a fresh data dir.
    console.warn(`[migrate] Failed to migrate ${legacyDir} → ${newDataDir}: ${err.message}. Starting fresh.`);
  }
}

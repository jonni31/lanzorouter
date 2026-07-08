import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.ZEVAI_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "playwright", "playwright-core", "camoufox-js"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    // cli/.build-home is a throwaway HOME the CLI build points at (HOME override
    // in build-cli.js); the app writes a transient sqlite DB + rotating backups
    // there during static generation. The tracer then tries to copy those
    // already-deleted WAL/backup files and logs ENOENT. Nothing here belongs in
    // the bundle, so exclude it.
    "*": ["./gitbook/**/*", "./cli/.build-home/**/*"]
  },
  outputFileTracingIncludes: {
    // Playwright loads browsers.json + its browser registry through dynamic paths the
    // Next file tracer can't follow, so force-include the full packages in the standalone
    // build (otherwise: "Cannot find module .../playwright-core/browsers.json").
    "*": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/playwright/**/*",
      // bulkImportBrowserEngine.js loads these runtime helpers via a dynamic
      // require(`../../../../cli/hooks/${name}`) the file tracer can't follow, so the
      // standalone build omitted cli/hooks entirely and bulk import ran a stale
      // "playwright installed but cannot be required" path. Force-include them.
      "./cli/hooks/**/*",
      // camoufox-js (optional stealth Firefox engine) is loaded via a runtime
      // require in camoufoxRuntime.js. It's externalized above so webpack won't
      // bundle it, but the standalone tracer still needs the package on disk.
      "./node_modules/camoufox-js/**/*",
      // sql.js loads its wasm binary (sql-wasm.wasm) through a runtime path the
      // tracer can't follow, so the standalone build dropped it and the sql.js
      // fallback crashed with "ENOENT sql-wasm.wasm". Force-include the package
      // so the universal pure-JS fallback always works (no native build needed).
      "./node_modules/sql.js/**/*"
    ]
  },
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Exclude logs, .next, gitbook subapp from watcher
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next|gitbook|cli)[\\/]/ };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;

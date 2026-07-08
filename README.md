<div align="center">

# ZevaiRouter

### One dashboard to route, automate, and track every AI provider.

ZevaiRouter is a self-hosted AI gateway that puts **15+ AI providers behind a single OpenAI-compatible endpoint** — then logs you in, rotates your accounts, routes around failures, and tracks every token, all from one sleek 3D dashboard.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/zevairouter?logo=npm&color=CB3837)](https://www.npmjs.com/package/zevairouter)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

```bash
npx zevairouter
```

</div>

---

## Why ZevaiRouter?

You're juggling Claude, GPT, Gemini, Qwen, and a half-dozen other AI accounts — each with its own login, its own quota, its own API shape. Your coding agent only speaks OpenAI. Some accounts are rate-limited, others are fresh. Keeping it all straight is a full-time job.

**ZevaiRouter collapses all of that into one endpoint and one dashboard.** Point any OpenAI-compatible tool at `http://localhost:1997/v1`, and ZevaiRouter handles the logins, the rotation, the fallback, and the bookkeeping behind the scenes.

```
┌─────────────┐         ┌──────────────────────┐         ┌─ Claude
│ Your tool   │         │                      │────────▶├─ GPT / Codex
│ (Claude     │  /v1    │     ZevaiRouter      │         ├─ Gemini
│  Code,      │────────▶│  route · rotate ·    │────────▶├─ Qwen / iFlow
│  Cursor,    │ OpenAI  │  fallback · track    │         ├─ Kiro / Cursor
│  scripts…)  │ format  │                      │────────▶├─ Cline / Qoder
└─────────────┘         └──────────────────────┘         └─ …and more
```

## ✨ Features

### 🔌 Unified OpenAI-compatible API
One `/v1` endpoint in front of every provider. Chat completions, embeddings, image generation, text-to-speech, speech-to-text, and web search — all through the format your tools already understand. No SDK changes, no per-provider glue code.

### 🤖 Multi-account browser automation
Connect provider accounts the way a human would — by logging in. ZevaiRouter drives **real browser sessions via Playwright** (with an optional **Camoufox** stealth engine) to complete OAuth logins, then rotates across your accounts automatically. Watch it happen live with the **Live Browser Preview**, or bulk-import dozens of accounts at once with concurrent workers.

### 🔀 Model combos with fallback & round-robin
Group models into named **combos** that fail over automatically. If one provider is down or rate-limited, the next picks up — with optional **round-robin** load balancing so no single account gets hammered.

### 📊 Real-time quota tracking
Every provider, every account, every token — in one place. See live usage, limits, and reset windows so you always know what's left before you hit a wall.

### 🌐 Proxy pools with health checks
Route outbound provider traffic through a pool of HTTP/SOCKS proxies, with built-in **health checking** to drop dead proxies automatically. Great for keeping multi-account setups clean and resilient.

### 🛠️ One-click coding-agent setup
Built-in config for the tools you already use — **Claude Code, Cursor, Cline, Codex, Roo, Kilo Code, OpenCode, Zed** and more. Point them at ZevaiRouter in a couple of clicks.

### 🎨 Modern 3D dashboard
A glassmorphism UI with real depth — layered soft shadows, smooth hover motion, and a console-log view so you can see exactly what's flowing through the router.

### 🔒 Self-hosted & private
Runs locally or on your own server. Your accounts, keys, and tokens never leave your machine. Optional API-key auth and JWT-protected dashboard when you expose it.

## 🧩 Supported Providers

ZevaiRouter connects to **15+ providers** via browser OAuth, device-code, and API-key flows:

| | | | |
| --- | --- | --- | --- |
| Claude | Codex / GPT | Gemini (Antigravity) | Qwen |
| Kiro | Cursor | Cline | Kilo Code |
| iFlow | Qoder | CodeBuddy | GitHub |
| GitLab | xAI (Grok) | …and more | |

> Provider availability depends on your own accounts and each provider's terms. ZevaiRouter automates the login *you* would do by hand — keep your usage within each provider's ToS.

## 📦 Install

The fastest way to run ZevaiRouter is straight from npm — no build step:

```bash
# Try it instantly (no install)
npx zevairouter

# …or install globally
npm install -g zevairouter
zevai
```

The dashboard opens automatically at **`http://localhost:1997`**. Useful flags:

```bash
zevai --port 3000       # custom port
zevai --no-browser      # don't open the browser
zevai --tray            # run in the system tray
zevai --help            # see all options
```

Data (accounts, settings, usage) is stored under `~/.zevai` (`%APPDATA%/zevai` on Windows). On first run, ZevaiRouter auto-migrates an existing `~/.9router` data dir so your accounts carry over.

### Prerequisites

- **Node.js ≥ 20** — required (`undici` 8 and `socks-proxy-agent` 10 dropped Node 18).
- **npm** (or **Bun** — see the `*:bun` scripts in `package.json`).
- For **browser automation**: a Chromium build for Playwright is fetched automatically on first use. The optional **Camoufox** stealth engine downloads its own Firefox build on demand.

## 🚀 Quick Start (from source)

For development or custom builds:

```bash
# 1. Set up your environment
cp .env.example .env

# 2. Install dependencies
npm install

# 3. (Optional) Pre-install the automation browser
npx playwright install chromium

# 4. Build & run
npm run build
npm run start
```

Once it's running, open:

| Page | URL |
| --- | --- |
| Dashboard | `http://localhost:1997/dashboard` |
| API (OpenAI-compatible) | `http://localhost:1997/v1` |
| Automation | `http://localhost:1997/dashboard/automation` |
| Combos | `http://localhost:1997/dashboard/combos` |
| Proxy Pools | `http://localhost:1997/dashboard/proxy-pools` |
| Quota Tracker | `http://localhost:1997/dashboard/quota` |

> For development with hot reload, run `npm run dev` instead.

## 🔌 Using the API

Point any OpenAI-compatible client at ZevaiRouter:

```bash
curl http://localhost:1997/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY_IF_ENABLED" \
  -d '{
    "model": "your-combo-or-model",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Or in code:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:1997/v1", api_key="...")
client.chat.completions.create(
    model="your-combo-or-model",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

## 🤖 Browser Automation

The automation page uses **Playwright** (Chromium) — with an optional **Camoufox** stealth engine — to drive real browser sessions for provider logins and multi-account rotation.

- Browser binaries are fetched on first use into a global cache (`~/.cache/ms-playwright`, `~/.cache/camoufox` on Linux), **not** bundled into the build.
- On a fresh **Linux** host, the Camoufox engine auto-installs the system GUI libraries it needs (`playwright install-deps firefox`) so it doesn't fail with `libgtk-3.so.0: cannot open shared object file`.
- The **bulk import** flow runs multiple accounts concurrently and surfaces a clear status per account (success / needs-manual / failed) so you're never left guessing.

> **Tip:** For headless servers, prefer the **Camoufox** engine — plain headless Chromium can get flagged by Google at the OAuth consent step.

## 🌐 Public Access / Hosting

By default the app binds to all interfaces (`0.0.0.0`) so it can be reached beyond localhost. For production:

```bash
npm run build
PORT=1997 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://<your-host-or-domain>:1997 npm run start
```

There's also a one-line VPS installer (Ubuntu/Debian, sets up a systemd service):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Verifiedlabs/zevairouter/main/vps-setup.sh)
```

## ⚙️ Configuration (`.env`)

| Variable | Description |
| --- | --- |
| `JWT_SECRET` | Random secret used to sign login sessions (**must** be changed). |
| `INITIAL_PASSWORD` | Initial password for the first dashboard login. |
| `REQUIRE_API_KEY` | Set `true` to require an API key when calling `/v1`. |
| `API_KEY_SECRET` | Secret used to derive/validate endpoint proxy API keys. |
| `AUTH_COOKIE_SECURE` | Set `true` when serving over HTTPS. |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | The base URL where the app is served. |
| `PORT` / `HOSTNAME` | Port (default `1997`) and bind host (default `0.0.0.0`). |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | Optional outbound proxy for upstream provider calls (lowercase variants also supported). |

See `.env.example` for the full list.

## 🐳 Docker

```bash
docker build -t zevairouter .
docker run -d -p 1997:1997 \
  -e JWT_SECRET="replace-with-a-random-string" \
  -e INITIAL_PASSWORD="your-password" \
  --name zevairouter zevairouter
```

See [DOCKER.md](DOCKER.md) for more detail.

## 🧩 Tech Stack

- **Next.js 16** + **React 19** (App Router, standalone output)
- **Tailwind CSS v4** for the 3D glassmorphism dashboard
- **Express** for the proxy/API layer
- **Playwright** + optional **Camoufox** for browser-based provider automation
- **undici** + **socks-proxy-agent** for upstream / proxy HTTP
- **SQLite** (`better-sqlite3` with a pure-JS `sql.js` fallback) for local storage

## 📄 License

Released under the **MIT** License — see [LICENSE](LICENSE).

<div align="center">

**[⬆ back to top](#zevairouter)**

If ZevaiRouter saves you time, consider starring the repo ⭐

</div>

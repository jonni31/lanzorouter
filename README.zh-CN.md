<div align="center">

# ZevaiRouter

### 一个控制面板，路由、自动化并跟踪所有 AI 提供商。

ZevaiRouter 是一个自托管的 AI 路由器，提供 **兼容 OpenAI 的 API**、**多账户浏览器自动化** 以及 **内置配额跟踪** —— 全部集成在一个精美的 **3D 控制面板** 中。

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## ✨ 功能特点

- **统一路由** — 在众多 AI 提供商前提供单一的兼容 OpenAI 的端点（`/v1`）。
- **多账户自动化** — 自动连接并轮询多个提供商账户，并通过 **实时浏览器预览（Live Browser Preview）** 使用 Playwright 驱动真实的提供商登录。
- **配额跟踪** — 在一处查看每个提供商和账户的实时使用量与限额。
- **3D 控制面板** — 现代的拟态玻璃 UI，具有立体感、多层柔和阴影和流畅的悬停动画。
- **自托管** — 在本地或你自己的服务器上运行。你的 API 密钥始终掌握在自己手中。
- **即插即用** — 与任何已经使用 OpenAI 格式的工具或编程代理立即兼容。

## ✅ 前置要求

- **Node.js ≥ 20** — 必需。部分运行时依赖（`undici` 8、`socks-proxy-agent` 10）已不再支持 Node 18。
- **npm**（或 **Bun** — 参见 `package.json` 中的 `*:bun` 脚本）。
- 用于 **浏览器自动化 / 实时浏览器预览**：需要 Playwright 的 Chromium 构建（详见下文）。

## 🚀 快速开始

```bash
# 1. 设置环境变量
cp .env.example .env

# 2. 安装依赖
npm install

# 3.（可选）安装自动化使用的 Chromium 浏览器
npx playwright install chromium

# 4. 构建并运行
npm run build
npm run start
```

运行后，打开：

| 页面 | URL |
| --- | --- |
| 控制面板 | `http://localhost:1997/dashboard` |
| API（兼容 OpenAI） | `http://localhost:1997/v1` |
| 自动化 | `http://localhost:1997/dashboard/automation` |
| 配额跟踪器 | `http://localhost:1997/dashboard/quota` |

> 如需带热重载的开发模式，请改用 `npm run dev`。

## 🤖 浏览器自动化（实时浏览器预览）

自动化页面使用 **Playwright** 驱动真实的浏览器会话，用于提供商登录和多账户轮询。

- `playwright` 位于 `optionalDependencies` 中，因此普通的 `npm install` 会尝试自动设置它。如果缺少 Chromium 二进制文件，请显式安装：
  ```bash
  npx playwright install chromium
  ```
- Chromium 二进制文件存储在 Playwright 的全局缓存中（macOS 为 `~/Library/Caches/ms-playwright`，Linux 为 `~/.cache/ms-playwright`）—— **不在**项目内部，因此无需打包到构建产物中。
- 自动化在两种运行模式下表现一致：
  - **开发模式：** `npm run dev`
  - **生产 / standalone：** `npm run start`

> **注意：** 较早的 standalone 构建可能会以 `Cannot find module .../playwright-core/browsers.json` 报错，或者在批量导入时报出误导性的 `playwright installed but cannot be required` 错误（即使 Playwright 已正确安装）。两个问题现均已修复 —— standalone 构建会强制包含 Playwright 包 **以及** `cli/hooks` 运行时助手（`next.config.mjs` 中的 `serverExternalPackages` + `outputFileTracingIncludes`），启动脚本会将 Playwright 包链接到 `.next/standalone/node_modules`（`scripts/start-standalone.mjs`），且批量导入启动器（`bulkImportBrowserEngine.js`）会在回退到运行时助手之前先直接 `import` Playwright。

## 🌐 公网访问 / 部署

默认情况下应用程序绑定到所有网络接口（`0.0.0.0`），因此可以超出 localhost 访问。生产环境：

```bash
npm run build
PORT=1997 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://<your-host-or-domain>:1997 npm run start
```

## ⚙️ 配置（`.env`）

| 变量 | 描述 |
| --- | --- |
| `JWT_SECRET` | 用于签名登录会话的随机密钥（**必须**更改）。 |
| `INITIAL_PASSWORD` | 首次控制面板登录的初始密码。 |
| `REQUIRE_API_KEY` | 设为 `true` 以在调用 `/v1` 时要求 API 密钥。 |
| `API_KEY_SECRET` | 用于生成/验证端点代理 API 密钥的密钥。 |
| `AUTH_COOKIE_SECURE` | 通过 HTTPS 提供服务时设为 `true`。 |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | 应用程序提供服务的基础 URL。 |
| `PORT` / `HOSTNAME` | 端口（默认 `1997`）和绑定主机（默认 `0.0.0.0`）。 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | 用于上游提供商调用的可选出站代理（也支持小写变体）。 |

完整列表请参见 `.env.example`。

## 🐳 Docker

```bash
docker build -t zevairouter .
docker run -d -p 1997:1997 \
  -e JWT_SECRET="replace-with-a-random-string" \
  -e INITIAL_PASSWORD="your-password" \
  --name zevairouter zevairouter
```

更多详情请参见 [DOCKER.md](DOCKER.md)。

## 🧩 技术栈

- **Next.js 16** + **React 19**（App Router，standalone 输出）
- **Tailwind CSS v4**
- **Express** 作为代理/API 层
- **Playwright** 用于基于浏览器的提供商自动化
- **undici** + **socks-proxy-agent** 用于上游 / 代理 HTTP
- **SQLite**（`better-sqlite3` 可选，`sql.js` 作为回退）用于本地存储

## 📄 许可证

基于 **MIT** 许可证发布 —— 详见 [LICENSE](LICENSE)。

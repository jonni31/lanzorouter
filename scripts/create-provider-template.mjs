#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/create-provider-template.mjs --type custom --id example --alias ex --name "Example" --api-type openai --base-url https://api.example.com/v1
  node scripts/create-provider-template.mjs --type oauth --id example-oauth --alias exo --name "Example OAuth" --base-url https://api.example.com --scopes "openid,email,profile"
`);
}

function requireValue(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing --${key}`);
  }
  return value.trim();
}

function toConstName(id) {
  const name = id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return name.endsWith("_OAUTH") ? name.slice(0, -6) : name;
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function objectKey(id) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) ? id : JSON.stringify(id);
}

function providerMetadata({ id, alias, name, website = "", oauth = false }) {
  return `${objectKey(id)}: {
  id: ${json(id)},
  alias: ${json(alias)},
  name: ${json(name)},
  icon: "hub",
  color: "#0F766E",
  website: ${json(website)},
  notice: {
    signupUrl: ${json(website || "https://example.com/signup")}${oauth ? "" : ",\n    apiKeyUrl: \"https://example.com/api-keys\""}
  },
  authModes: [${oauth ? "\"oauth\"" : "\"apikey\""}],${oauth ? "\n  hasOAuth: true," : ""}
}`;
}

function customTemplate(args) {
  const id = requireValue(args, "id");
  const alias = requireValue(args, "alias");
  const name = requireValue(args, "name");
  const apiType = args["api-type"] || "openai";
  const baseUrl = requireValue(args, "base-url");
  const website = args.website || "";

  return `# ${name} Custom Provider Template

## Provider metadata

Add to \`src/shared/constants/providers.js\`:

\`\`\`js
${providerMetadata({ id, alias, name, website })}
\`\`\`

## Provider node defaults

Use these defaults when creating the provider node:

\`\`\`json
${json({ type: "custom-provider", name, prefix: alias, apiType, baseUrl })}
\`\`\`

## Validation checklist

- Add a provider connection from the dashboard.
- Test provider validation against \`${baseUrl}\`.
- Add one model alias if the provider does not expose \`/models\`.
- Run a chat request with model \`${alias}/<model-id>\`.
`;
}

function oauthTemplate(args) {
  const id = requireValue(args, "id");
  const alias = requireValue(args, "alias");
  const name = requireValue(args, "name");
  const baseUrl = requireValue(args, "base-url");
  const website = args.website || "";
  const scopes = (args.scopes || "openid,email,profile").split(",").map((s) => s.trim()).filter(Boolean);
  const constName = toConstName(id);

  return `# ${name} OAuth Provider Template

## Provider metadata

Add to \`src/shared/constants/providers.js\`:

\`\`\`js
${providerMetadata({ id, alias, name, website, oauth: true })}
\`\`\`

## OAuth config

Add to \`src/lib/oauth/constants/oauth.js\`:

\`\`\`js
export const ${constName}_CONFIG = {
  clientId: process.env.${constName}_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.${constName}_OAUTH_CLIENT_SECRET || "",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
  scopes: ${json(scopes)},
  apiBaseUrl: ${json(baseUrl)},
};
\`\`\`

## OAuth provider registration

Add to \`src/lib/oauth/providers.js\`:

\`\`\`js
${objectKey(id)}: {
  config: ${constName}_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return \`\${config.authorizeUrl}?\${params.toString()}\`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) throw new Error(\`Token exchange failed: \${await response.text()}\`);
    return response.json();
  },
  postExchange: async (tokens) => {
    const userInfoRes = await fetch(\`\${${constName}_CONFIG.userInfoUrl}?alt=json\`, {
      headers: { Authorization: \`Bearer \${tokens.access_token}\` },
    });
    const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};
    return { userInfo };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: extra?.userInfo?.email,
    displayName: extra?.userInfo?.name,
    providerSpecificData: {
      oauthClientId: ${constName}_CONFIG.clientId,
      oauthClientSecret: ${constName}_CONFIG.clientSecret,
    },
  }),
}
\`\`\`

## Validation checklist

- Set \`${constName}_OAUTH_CLIENT_ID\` and \`${constName}_OAUTH_CLIENT_SECRET\`.
- Login from dashboard OAuth flow.
- Confirm access token, refresh token, expiry, and email are saved.
- Force expiry and verify refresh works.
- Verify account fallback, quota cooldown, and Auto-clean Zero Credit behavior.
- Add request adapter/translator if \`${baseUrl}\` is not OpenAI-compatible.
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }
  const type = requireValue(args, "type");
  if (!["custom", "oauth"].includes(type)) throw new Error("--type must be custom or oauth");

  const id = requireValue(args, "id");
  const outDir = path.resolve("generated/provider-templates");
  fs.mkdirSync(outDir, { recursive: true });
  const output = type === "custom" ? customTemplate(args) : oauthTemplate(args);
  const file = path.join(outDir, `${id}.${type}.md`);
  fs.writeFileSync(file, output);
  console.log(`Created ${file}`);
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}

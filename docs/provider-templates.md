# Provider Templates

LanzoRouter has two repeatable paths for adding providers:

- **Custom provider**: OpenAI/Anthropic-compatible API with API key or bearer token.
- **Custom OAuth provider**: Google OAuth login first, then provider-specific API calls with the stored OAuth token, refresh token, and optional project metadata.

Use these templates to keep new providers consistent with Antigravity-style account health, quota cooldown, auto-clean, and fallback behavior.

## Custom provider template

Use this when the provider accepts an API key and exposes an OpenAI-compatible or Anthropic-compatible endpoint.

Required values:

- `id`: stable provider id, lowercase kebab-case.
- `alias`: short route prefix used in model ids.
- `name`: display name.
- `apiType`: `openai`, `anthropic`, or `custom-embedding`.
- `baseUrl`: upstream API base URL.
- `models`: optional known models; users can still add custom models from the UI.

Integration checklist:

1. Add provider metadata in `src/shared/constants/providers.js`.
2. Add model entries or allow custom models only.
3. Ensure `/api/providers` validation supports the provider `apiType`.
4. Verify connection add/test through dashboard.
5. Verify routing through `/v1/chat/completions` with `<alias>/<model>`.

Minimal provider metadata shape:

```js
example: {
  id: "example",
  alias: "ex",
  name: "Example Provider",
  icon: "hub",
  color: "#0F766E",
  website: "https://example.com",
  notice: {
    signupUrl: "https://example.com/signup",
    apiKeyUrl: "https://example.com/api-keys",
  },
  authModes: ["apikey"],
}
```

## Custom OAuth provider template

Use this when login is Google OAuth-like and accounts need refreshable tokens, account fallback, quota cooldown, and optional provider metadata similar to Antigravity.

Required values:

- `id`: stable provider id, lowercase kebab-case.
- `alias`: short route prefix.
- `name`: display name.
- `googleClientId`: OAuth client id.
- `googleClientSecret`: OAuth client secret if required.
- `scopes`: OAuth scopes.
- `apiBaseUrl`: upstream API base URL.
- `userInfoUrl`: usually `https://www.googleapis.com/oauth2/v1/userinfo`.
- Optional `postLoginProbe`: endpoint/body/header metadata to fetch project id, org id, tier id, or subscription state.
- Optional `refreshHeaders`: provider-specific headers used during refresh or API calls.

Integration checklist:

1. Add metadata in `src/shared/constants/providers.js` with `authModes: ["oauth"]` and `hasOAuth: true`.
2. Add OAuth config in `src/lib/oauth/constants/oauth.js`.
3. Register the OAuth provider in `src/lib/oauth/providers.js` using the authorization-code template.
4. Add request adapter/translator if upstream is not OpenAI-compatible.
5. Store provider-specific data under `providerSpecificData` only.
6. Verify OAuth login, refresh, project metadata probe, request routing, fallback, and auto-clean.

Minimal OAuth config shape:

```js
export const EXAMPLE_OAUTH_CONFIG = {
  clientId: process.env.EXAMPLE_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.EXAMPLE_OAUTH_CLIENT_SECRET || "",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
  scopes: ["openid", "email", "profile"],
  apiBaseUrl: "https://api.example.com",
};
```

Minimal OAuth provider registration shape:

```js
example: {
  config: EXAMPLE_OAUTH_CONFIG,
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
    return `${config.authorizeUrl}?${params.toString()}`;
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
    if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
    return response.json();
  },
  postExchange: async (tokens) => {
    const userInfoRes = await fetch(`${EXAMPLE_OAUTH_CONFIG.userInfoUrl}?alt=json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
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
      oauthClientId: EXAMPLE_OAUTH_CONFIG.clientId,
      oauthClientSecret: EXAMPLE_OAUTH_CONFIG.clientSecret,
    },
  }),
}
```

## Policy split

Built-in system policy:

- Refresh OAuth tokens before expiry when refresh token is available.
- Mark permanent auth failures unavailable/disabled after the system threshold.
- Respect account lock/cooldown and max fallback attempts.
- Apply provider health cooldown for quota/credit errors.

User preferences:

- Enable/disable Auto-clean Zero Credit per provider.
- Choose Auto-clean action per provider: disable or delete.
- Tune `Max Fallback Attempts` per provider.
- Tune `Quota Cooldown` per provider, including 1 week for slow-refresh providers.

## Generator

Run the generator to create starter files under `generated/provider-templates/`:

```bash
npm run provider:template -- --type custom --id example --alias ex --name "Example Provider" --api-type openai --base-url https://api.example.com/v1
npm run provider:template -- --type oauth --id example-oauth --alias exo --name "Example OAuth" --base-url https://api.example.com --scopes "openid,email,profile"
```

The generated files are intentionally not wired automatically. Review and paste them into the target integration points so provider-specific quirks stay explicit.

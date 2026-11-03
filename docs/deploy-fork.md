# Deploy a fork's control plane

A fork's `main` is code. The app on `app.kestrel-agent.com` is jaren's production Worker and is not updated by a push
to a fork. To make every GitHub-signed-in user see the provider list from your `main`, deploy the Worker to your own
Cloudflare account.

`packages/control/wrangler.fork.jsonc` and `.github/workflows/deploy-fork.yml` deploy a Worker named `kestrel-fork`
on its `workers.dev` URL. They never claim jaren's custom domains.

## 1. Cloudflare credentials

Create an API token with **Workers Scripts: Edit** and account read access, then add these GitHub Actions secrets to
the fork:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token |
| `CLOUDFLARE_ACCOUNT_ID` | the account id |

Alternatively run `wrangler login` locally and deploy by hand.

## 2. GitHub OAuth app

Create a GitHub OAuth app under the account that will own the deployment:

- Homepage: `https://kestrel-fork.<your-subdomain>.workers.dev`
- Authorization callback URL: `https://kestrel-fork.<your-subdomain>.workers.dev/auth/github/callback`

The client id and secret are the fork's own; jaren's OAuth secret is not in the repository and cannot be copied.

## 3. Worker secrets

From `packages/control`, with the fork config:

```sh
bunx wrangler secret put GITHUB_CLIENT_ID --config wrangler.fork.jsonc
bunx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.fork.jsonc
bunx wrangler secret put BOX_TOKEN --config wrangler.fork.jsonc          # any long random value
bunx wrangler secret put KESTREL_OPERATORS --config wrangler.fork.jsonc  # comma-separated GitHub logins
```

Do not set `DEV_SESSION_LOGIN` on a public Worker. Do not commit secrets or `.dev.vars`.

## 4. Deploy

Run **Actions → Deploy fork control** manually. It builds `packages/app/dist`, uploads the SPA as Worker assets, and
applies the `Hub` Durable Object migration.

The app is then at `https://kestrel-fork.<your-subdomain>.workers.dev`. Signing in with GitHub uses your OAuth app.
The Connections page lists the providers defined in `packages/control/src/providers.ts` — including OpenRouter, Z.ai,
DeepSeek, MiniMax and Kimi — for every signed-in user, because the list is server-side and not tied to an operator or
a dev session.

## 5. Point the desktop at the fork

The packaged desktop app defaults to jaren's production control plane. Launch it with the fork URL:

```sh
KESTREL_CONTROL_URL=https://kestrel-fork.<your-subdomain>.workers.dev \
  kestrel --no-sandbox
```

For a packaged `.deb`, set it in the desktop entry's `Exec` line or launch the binary with the variable. The desktop's
session is per control plane; sign in again against the fork.

## Local alternative

For local development, create a second GitHub OAuth app with callback
`http://localhost:<app port>/auth/github/callback`, put its id/secret in `packages/control/.dev.vars`, and run
`bun run dev`. That local Worker has the new providers and uses real GitHub sign-in.

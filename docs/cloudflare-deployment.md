# Cloudflare Deployment

This repo deploys as two Cloudflare surfaces:

- Web UI: Cloudflare Pages at `https://ally.andersseen.dev`.
- API/runner: Cloudflare Worker at `https://ally-api.andersseen.dev`.

Keeping them separate avoids routing conflicts between the static Astro app and
the Worker API. The web app calls the API with credentialed CORS, and the Worker
sets `ally_session` cookies on the API origin.

## 1. Register dev-auth client

Apply `docs/dev-auth-client-registration-prompt.md` in the
`Andersseen/devflare` repo first.

The production callback must match:

```text
https://ally-api.andersseen.dev/api/auth/callback
```

The local callback can also be registered for development:

```text
http://127.0.0.1:8787/api/auth/callback
```

For local development, the Node API has an insecure development-only session
secret so the sign-in button is usable immediately. Copy
`apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` when you need to
override provider URL, client ID, redirect URI, or use a stronger local secret.
Production Workers do not use the development fallback.

## 2. Create Cloudflare resources

Use Wrangler from `apps/worker`.

```bash
pnpm --filter @ally/worker exec wrangler d1 create ally-audits
pnpm --filter @ally/worker exec wrangler r2 bucket create ally-audit-artifacts
pnpm --filter @ally/worker exec wrangler queues create ally-audit-jobs
```

Copy the returned D1 `database_id` into `apps/worker/wrangler.jsonc`.

## 3. Configure Worker secrets

Never commit these values.

```bash
pnpm --filter @ally/worker exec wrangler secret put DEV_AUTH_CLIENT_SECRET
pnpm --filter @ally/worker exec wrangler secret put ALLY_SESSION_SECRET
```

Generate `ALLY_SESSION_SECRET` separately:

```bash
openssl rand -base64 48
```

For GitHub Actions deployment, add these repository or production environment
secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `DEV_AUTH_CLIENT_SECRET`
- `ALLY_SESSION_SECRET`

## 4. Apply D1 migrations

```bash
pnpm --filter @ally/worker run migrate:remote
```

This applies:

- `0001_audits.sql`
- `0002_audit_owner.sql`

## 5. Dry-run and deploy the Worker

```bash
pnpm run deploy:worker:dry-run
pnpm --filter @ally/worker deploy
```

After deploy, attach the custom domain:

```text
ally-api.andersseen.dev -> ally-audit-worker
```

## 6. Build and deploy the web UI

The public API URL is baked into the static Astro build.

```bash
pnpm run build:web:production
pnpm run deploy:web
```

Attach the Pages custom domain:

```text
ally.andersseen.dev -> ally-web
```

## 7. Smoke test

Before sign-in:

```bash
curl -i \
  -H 'content-type: application/json' \
  --data '{"url":"https://example.com"}' \
  https://ally-api.andersseen.dev/api/audits
```

Expected for protected audit routes:

```text
401
{"error":"Authentication required"}
```

From the browser:

1. Open `https://ally.andersseen.dev`.
2. Sign in through dev-auth.
3. Open the protected dashboard from `/dashboard`.
4. Submit one small public URL.
5. Confirm status polling and report rendering.

## 8. Cost controls still owed

Authentication prevents anonymous abuse, but production should also add:

- Per-user daily audit quota.
- URL/domain denylist or allowlist for private/internal hosts.
- Queue concurrency limits matched to the free tier.
- Structured audit duration metrics.
- A manual kill switch, for example `AUDITS_ENABLED=false`.

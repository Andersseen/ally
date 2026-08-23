# Cloudflare Deployment

This repo deploys as three surfaces:

- Web UI: Cloudflare Pages at `https://ally.andersseen.dev`.
- API/control plane: Cloudflare Worker route at `https://ally.andersseen.dev/api/*`.
- Execution plane: Cloudflare Containers, owned by the Worker and triggered
  from a native Cloudflare Queues consumer. The same `apps/runner` Docker
  image can still run on an external Docker host as a fallback; either way it
  reports back to `/api/runner/*` and has no D1/R2 access of its own.

Keeping the Worker under the same site origin as the web UI matches the
registered dev-auth callback byte for byte and lets the Worker set
`ally_session` cookies on the same host the static UI uses.

## 1. Register dev-auth client

Apply `docs/dev-auth-client-registration-prompt.md` in the
`Andersseen/devflare` repo first.

The production callback must match:

```text
https://ally.andersseen.dev/api/auth/callback
```

The local callback can also be registered for development:

```text
http://127.0.0.1:8787/api/auth/callback
```

For local development, copy `apps/worker/.dev.vars.example` to
`apps/worker/.dev.vars` and fill in the confidential client secret plus a local
session secret. `.dev.vars` is gitignored; do not commit those values.
Production Workers read both secrets from Cloudflare Worker secrets.

## 2. Create Cloudflare resources

Use Wrangler from `apps/worker`.

```bash
pnpm --filter @ally/worker exec wrangler d1 create ally-audits
pnpm --filter @ally/worker exec wrangler r2 bucket create ally-audit-artifacts
pnpm --filter @ally/worker exec wrangler queues create ally-audit-jobs
pnpm --filter @ally/worker exec wrangler queues create ally-audit-jobs-dlq
```

Copy the returned D1 `database_id` into `apps/worker/wrangler.jsonc`.

The queue consumer is configured declaratively in
`apps/worker/wrangler.jsonc`; `wrangler deploy` registers the Worker's
native `queue()` handler and dead-letter queue settings. Do not add an HTTP
pull consumer unless you are deliberately using the external runner fallback
in section 7.

## 3. Configure Worker secrets

Never commit these values.

```bash
pnpm --filter @ally/worker exec wrangler secret put DEV_AUTH_CLIENT_SECRET
pnpm --filter @ally/worker exec wrangler secret put ALLY_SESSION_SECRET
pnpm --filter @ally/worker exec wrangler secret put ALLY_RUNNER_SECRET
```

Generate each with:

```bash
openssl rand -base64 48
```

`ALLY_RUNNER_SECRET` is the bearer token the runner presents to
`/api/runner/*` — generate a separate value from `ALLY_SESSION_SECRET`. For
Cloudflare Containers, the Worker reads this secret and passes it into the
container instance at start time; for the external fallback, give the same
value to the runner's own configuration (`apps/runner/.env`, or your
container platform's secret store). Never commit it to `wrangler.jsonc`.

For GitHub Actions deployment, add these repository or production environment
secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `DEV_AUTH_CLIENT_SECRET`
- `ALLY_SESSION_SECRET`
- `ALLY_RUNNER_SECRET`

`CLOUDFLARE_API_TOKEN` must be scoped for every resource the workflow touches:
Workers Scripts, D1, R2, Queues, Pages, and Cloudflare Containers. In the
current Cloudflare token UI, Containers appears as an account permission named
`Containers Edit` or `Containers Write`. The deploy workflow preflights
`/accounts/<account_id>/containers/me` before building the Docker image so a
missing Containers permission, or an account plan that cannot use Containers,
fails quickly with a clear error.

## 4. Apply D1 migrations

```bash
pnpm --filter @ally/worker run migrate:remote
```

This applies, in order:

- `0001_audits.sql`
- `0002_audit_owner.sql`
- `0003_runner_state.sql` — widens `status` to the full job lifecycle (queued,
  claimed, running, persisting, completed, failed, timed_out, cancelled) and
  adds `current_stage`, `attempt`, `last_error` (replaces `error`),
  `runner_id`, `raw_findings`, `keyboard_warnings`, `engines_failed`,
  `score_version`.

## 5. Dry-run and deploy the Worker

```bash
pnpm run deploy:worker:dry-run
pnpm --filter @ally/worker deploy
```

After deploy, attach the custom domain:

```text
ally.andersseen.dev/api/* -> ally-audit-worker
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

## 7. Deploy the execution plane

Cloudflare Containers is the default path. The Worker config declares:

- `AuditRunnerContainer` as a container-enabled Durable Object.
- `Dockerfile.runner` (repo root) as the container image.
- `AUDIT_RUNNER` as the binding used by the Worker's `queue()` handler.
- `ally-audit-jobs` as both the producer queue and native consumer queue.

Deploying the Worker builds/pushes the runner image and registers the native
queue consumer. The committed production guardrail is deliberately narrow:
`max_instances: 1`, one queue retry, and one accepted audit per UTC day
globally and per user. Raise those `wrangler.jsonc` vars only after reviewing
billable usage.

The runner image exposes `/healthz` and `/run` on `ALLY_HEALTH_PORT`
(default 8080). The Worker starts one named container per audit id, passes
`ALLY_WORKER_BASE_URL`, `ALLY_RUNNER_SECRET`, and `ALLY_RUNNER_ID` as
runtime environment variables, waits for the health port, then POSTs the
queued job to `/run`.

### External Docker host fallback

The runner is a plain Docker image (`Dockerfile.runner`) — build and
push it to whatever registry your host reads from, then run it with the
environment variables in `apps/runner/.env.example` filled in
(`ALLY_WORKER_BASE_URL`, `ALLY_RUNNER_SECRET`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_QUEUES_API_TOKEN`, `CLOUDFLARE_QUEUE_ID`).

Before using this fallback, add the old HTTP pull consumer:

```bash
pnpm --filter @ally/worker exec wrangler queues consumer http add ally-audit-jobs \
  --dead-letter-queue ally-audit-jobs-dlq \
  --max-retries 5 \
  --visibility-timeout-ms 150000
```

Set `--visibility-timeout-ms` comfortably above the runner's
`ALLY_AUDIT_TIMEOUT_MS` (default 120000) so a job's lease doesn't expire and
get redelivered to another puller while it's still legitimately running.
You'll also need a Cloudflare API token scoped to Queues and the queue id
from `pnpm --filter @ally/worker exec wrangler queues list`.

```bash
docker build -t ally-runner -f Dockerfile.runner .
docker run --rm \
  -e ALLY_WORKER_BASE_URL=https://ally.andersseen.dev \
  -e ALLY_RUNNER_SECRET=... \
  -e CLOUDFLARE_ACCOUNT_ID=... \
  -e CLOUDFLARE_QUEUES_API_TOKEN=... \
  -e CLOUDFLARE_QUEUE_ID=... \
  -p 8080:8080 \
  ally-runner \
  node --experimental-strip-types src/main.ts
```

This has not been build-tested against a real Docker daemon or a real
Cloudflare account from this repository's automated environment — validate
the image build and a real queue pull/ack round trip before relying on it in
production. The image works the same way on Coolify, Fly.io, Railway, Cloud
Run, or a bare VM with Docker: it needs outbound HTTPS to Cloudflare's API
and to your Worker's origin, and nothing provider-specific. `/healthz` on
`ALLY_HEALTH_PORT` (default 8080) is available for the platform's health
check. In standalone mode, `SIGTERM` triggers a graceful shutdown: the
process stops pulling new jobs, lets an in-flight one finish, then exits.

Run more than one instance for throughput or availability — the queue's
lease semantics make concurrent runners safe without any coordination
between them.

## 8. Smoke test

Before sign-in:

```bash
curl -i \
  -H 'content-type: application/json' \
  --data '{"url":"https://example.com"}' \
  https://ally.andersseen.dev/api/audits
```

Expected for protected audit routes:

```text
401
{"error":"Authentication required"}
```

The runner-only surface should reject an unauthenticated or wrong-secret
request:

```bash
curl -i -X POST https://ally.andersseen.dev/api/runner/audits/00000000-0000-0000-0000-000000000000/claim
# 401 {"error":"Runner authentication required"}
```

From the browser:

1. Open `https://ally.andersseen.dev`.
2. Sign in through dev-auth.
3. Open the protected dashboard from `/dashboard`.
4. Submit one small public URL.
5. Confirm the job reaches `queued`, then real per-engine progress appears,
   then `completed`, and the report renders.
6. Confirm the URL shows up in "Recent audits" and opens the same report.

## 9. Cost controls still owed

Authentication prevents anonymous abuse, and the production Worker now ships
with conservative cost guardrails:

- `limits.cpu_ms: 1000` and `limits.subrequests: 100`.
- `AUDITS_ENABLED=true`; set it to `false` as an emergency stop for new work.
- `max_instances: 1` for Cloudflare Containers.
- Container `sleepAfter: 30s`.
- `ALLY_AUDIT_WINDOW_DAYS=30`.
- `ALLY_USER_AUDIT_WINDOW_LIMIT=30`.
- `ALLY_GLOBAL_AUDIT_WINDOW_LIMIT=30`.
- `ALLY_GLOBAL_ACTIVE_AUDIT_LIMIT=1`.
- `AUDIT_MAX_ATTEMPTS=1` and queue `max_retries=1`.

Rolling audit limits ignore audits that were cancelled before the runner made
its first attempt (`status = cancelled` and `attempt = 0`). Those early
cancellations do not start a paid container run, so they should not consume the
development quota.

These are technical guardrails, not a Cloudflare billing hard cap. Keep the
Cloudflare budget alerts enabled and check Billable Usage after every real
smoke test. Remaining follow-up:

- Structured audit duration metrics (durations are already logged per-stage;
  aggregating them is the remaining step).

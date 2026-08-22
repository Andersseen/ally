# Hosted Web Audit MVP

Ally's hosted path keeps the audit domain pipeline shared:

```text
browser provider
  -> @ally/audit-runner
  -> @ally/core runAudit
  -> engine adapters + keyboard analyzer
  -> AuditRun
  -> environment-specific persistence
```

The environment decides browser provider, persistence, job transport, and
logging — never accessibility semantics. `@ally/audit-runner` stays the only
place that knows about engines, in every environment.

## Architecture: hybrid, not Worker-native

Ally's Worker previously ran a compatibility spike (`GET /api/compatibility`)
to decide between a fully Cloudflare-native audit runner (Browser Run) and a
hybrid Node runner. That decision is now made, based on the spike's own
findings: IBM Equal Access and QualWeb resolve package/bundle files with
Node APIs Workers don't provide the same way, and the keyboard analyzer
resolves `tabbable`'s bundle the same way. The spike endpoint stays as a
diagnostic — the evidence for why the architecture below looks the way it
does — but no longer gates anything.

```text
                   ┌──────────────────┐
                   │    Astro Web     │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │ Cloudflare API   │   control plane: D1, R2, auth,
                   │ Worker           │   public API — owns all state
                   └────────┬─────────┘
                            │ produces
                            ▼
                        Cloudflare Queue (ally-audit-jobs)
                            │ HTTP pull consumer
                            ▼
                  ┌───────────────────┐
                  │  apps/runner      │   execution plane only:
                  │  (Node process)   │   no D1/R2 access of its own
                  └─────────┬─────────┘
                            │
                            ▼
                   Playwright/Chromium
                            │
                            ▼
                    @ally/audit-runner
                            │
              ┌─────────────┼─────────────┐
              │             │             │
             axe           IBM           Alfa
              │             │             │
              └──────┬──────┴──────┬──────┘
                     │           QualWeb
                     │
                  keyboard
                     │
                     ▼
              /api/runner/* (ALLY_RUNNER_SECRET)
                     │
                     ▼
                Worker writes D1 + R2
```

The Worker remains the sole owner of D1, R2, and the public API. The runner
is purely an execution plane: it claims a job, runs the shared pipeline, and
reports state back through `/api/runner/*` — it never touches D1 or R2
directly.

## One pipeline, reused three ways

```text
Local CLI                Hosted Node runner       Local dev (pnpm dev)
     │                          │                         │
     ├── @ally/browser          ├── PlaywrightChromium-    ├── same
     │   openPage()             │   BrowserProvider        │   provider
     │                          │   (@ally/runner-core)     │
     ▼                          ▼                         ▼
@ally/audit-runner        @ally/audit-runner        @ally/audit-runner
```

`@ally/runner-core`'s `executeAuditJob(job, ports)` is the one place that
knows how a hosted job is executed: claim → running → open browser → run
`@ally/audit-runner` → persisting → complete/fail. `apps/runner` (the real
hosted process) and `apps/worker/src/local-dev.ts` (local dev) call it with
different `RunnerPersistencePort`/`BrowserProvider` implementations, never
with different logic — there is no `CloudflareAuditEngine`/`NodeAuditEngine`
split.

## Job delivery: Cloudflare Queues' HTTP pull consumer

The runner is a plain Node process outside Cloudflare's own runtime, so it
consumes the queue through Cloudflare's officially supported pull-consumer
REST API (`POST .../queues/{id}/messages/pull` and `.../messages/ack`),
authenticated with a Cloudflare API token scoped to Queues on that one queue.
This was chosen over a custom leasing endpoint because it gives, for free:

- **No double execution** — `visibility_timeout_ms` leases a message; it
  isn't visible to another puller while leased.
- **Stranded-job recovery** — a runner that crashes or stalls simply lets
  its lease expire; the message becomes visible again automatically.
- **Safe retries** — `max_retries` plus a dead-letter queue bound how many
  times a bad job is retried before it's set aside for inspection.

See `apps/worker/wrangler.jsonc` for the exact `wrangler queues consumer
http add` configuration, and `apps/runner/src/queue-client.ts` for the
client. The Worker's producer binding (`env.AUDIT_QUEUE.send`) is unchanged.

## Runner authentication

The runner has no D1/R2 bindings — it reports every state change through
`/api/runner/*` on the Worker, authenticated by `Authorization: Bearer
<ALLY_RUNNER_SECRET>` (`apps/worker/src/runner-auth.ts`, constant-time
compared). This is a second, independent trust boundary from the Cloudflare
API token used for queue pulling, and from DevAuth/user sessions — never
reused between the three.

## Job state machine

`apps/worker/src/audit-state.ts` defines the legal transitions:

```text
queued -> claimed -> running -> persisting -> completed
                  \       \          \
                   \       \          -> failed / timed_out
                    -> failed / timed_out / cancelled
```

`claimed` and `running` both accept a `claim` event again — that's what
makes at-least-once queue redelivery safe: a second attempt (or the same
attempt after a stranded lease) can re-claim cleanly instead of erroring. A
row already in a terminal state (`completed`, `failed`, `timed_out`,
`cancelled`) rejects every further transition; the runner-auth routes return
`{terminal: true}` from `/claim` in that case so the caller acks the queue
message and does nothing else. `attempt` is incremented server-side on every
claim and capped by `AUDIT_MAX_ATTEMPTS` (default 3, in `wrangler.jsonc`'s
`vars`).

## SSRF protection

`@ally/net-guard` is the reusable SSRF layer (see its own doc comments for
the full range list). Two entries:

- `.` (portable): syntactic checks only — protocol, credentials, literal
  private/loopback/link-local/reserved IPs, `.local`/`.internal`/`localhost`
  names. Safe to import from the Worker (no DNS API in Workers), used there
  as a cheap best-effort rejection at submission time.
- `./node` (Node only): adds DNS resolution and a Playwright navigation
  guard (`guardPage`) that re-validates the target on the initial navigation
  **and every redirect**, failing closed on any violation or DNS failure.
  This is the runner's actual enforcement point — the Worker's check is
  defense-in-depth only.

An explicit, narrow allowlist (`ALLY_SSRF_ALLOW_HOSTS` in local dev; a
`networkPolicy.allowHostnames` port option in `@ally/runner-core`) exempts
exact `host:port` values from the private-network check — never protocol or
credential checks. It exists for a deliberately configured exception (an
operator's own internal target), and is what lets the hosted-flow
integration test run the real guarded pipeline against a local fixture
server instead of weakening the guard for tests. Unset by default.

## Hosted MVP pieces

- `apps/web` is a static Astro UI: `/` is the sign-in gate, `/dashboard` has
  the audit form, real backend-reported progress, and a recent-audits list,
  `/reports` renders a completed audit.
- `apps/worker` exposes the public API (`/api/auth/*`, `/api/audits*`,
  `/api/compatibility`) and the runner-only API (`/api/runner/*`). D1 stores
  audit metadata/state; R2 stores `audit.json` and raw engine artifacts,
  written only by the one successful `/api/runner/audits/:id/complete` call
  — there is never a partially-written final artifact to guard against.
- `apps/runner` is the standalone Node process. See its own `package.json`
  and `Dockerfile`.
- `packages/runner-core` is the shared job-execution core described above.
- `packages/net-guard` is the SSRF layer described above.

## Local development runner

`pnpm dev` runs two processes via Turborepo, unchanged in shape from before
this milestone:

```text
Astro web UI (:4321)
  -> Node audit API (:8787)
  -> local Playwright + @ally/runner-core's executeAuditJob
  -> shared Ally audit packages
```

`apps/worker/src/local-dev.ts` exports `createLocalDevServer()`, which wires
`@ally/runner-core`'s `executeAuditJob` to an in-memory
`RunnerPersistencePort` and the real `PlaywrightChromiumBrowserProvider` — no
queue indirection locally, but the _same_ runner code path the hosted
process uses, not a separate ad hoc audit call. This is also the harness the
hosted-flow integration test (`apps/worker/src/hosted-flow.test.ts`) starts
and drives over real HTTP.

To run the Cloudflare-native compatibility spike:

```bash
pnpm --filter @ally/worker run dev:worker
```

To run the real standalone runner against a real Cloudflare account (not
needed for ordinary UI/core development):

```bash
cp apps/runner/.env.example apps/runner/.env   # fill in real values
pnpm --filter @ally/runner run start
```

## Setup notes

Replace placeholder Cloudflare resource IDs in `apps/worker/wrangler.jsonc`
before deployment. See `docs/cloudflare-deployment.md` for the full
resource-creation and secret-provisioning sequence, including the Queues
pull-consumer and dead-letter-queue setup, and the runner's Docker
deployment.

## dev-auth preparation

Ally is prepared to consume DevFlare's `dev-auth` OAuth2.1/OIDC provider through
the app-owned session pattern used in `Andersseen/devflare`. The Worker starts
an authorization-code-with-PKCE login, exchanges the callback code for provider
userinfo, then stores a signed `ally_session` cookie for the Ally app.

Required configuration:

- `DEV_AUTH_URL`: OIDC provider origin. The default is
  `https://auth-devflare.andersseen.dev`; local dev-auth should use another
  port than Ally's local API `:8787`.
- `DEV_AUTH_CLIENT_ID`: OAuth client registered in dev-auth. The local default
  placeholder is `ally-dev`.
- `DEV_AUTH_REDIRECT_URI`: callback registered in dev-auth, such as
  `http://127.0.0.1:8787/api/auth/callback` locally or
  `https://ally.andersseen.dev/api/auth/callback` in production.
- `ALLY_SESSION_SECRET` or `DEV_AUTH_CLIENT_SECRET`: secret used to sign Ally's
  local app session. Store it as a Worker secret, not in `wrangler.jsonc`.

Hosted audit creation, status, results, and compatibility checks require a valid
`ally_session` cookie. The web root `/` is the sign-in gate, and `/dashboard`
contains the protected audit form. The provider client registration and
production callback still need to be applied in `Andersseen/devflare`.

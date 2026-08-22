# Ally Software Design Document

## 1. Purpose

Ally is an accessibility audit toolkit and hosted audit MVP. The hosted product
lets a user submit one public URL, runs automated accessibility engines against
that page, normalizes and deduplicates findings through shared domain packages,
and exposes a report-friendly JSON artifact.

The current hosted implementation is intentionally narrow: it validates the
architecture, UI flow, persistence shape, and authentication boundary before
expanding into multi-page crawling, organization accounts, organization dashboards, or full
claimable conformance workflows.

## 2. Goals

- Reuse the same audit domain model across CLI, local development, and hosted
  execution — one pipeline (`@ally/audit-runner`), reused by every caller.
- Keep the static web UI and Worker API under one production site origin so
  OAuth callbacks and app cookies match exactly.
- Queue long-running audits instead of performing them in the request path,
  through a supported transport (Cloudflare Queues' HTTP pull consumer) that
  gives lease/retry/dead-letter semantics for free.
- Persist audit metadata in D1 and complete artifacts in R2, written only by
  the Worker — the execution plane never touches either directly.
- Prepare app-owned sessions through DevFlare `dev-auth` without coupling Ally
  to the provider's cookies or database.
- Require authentication before any hosted audit route can spend Cloudflare
  Queues, D1, or R2 resources, and require a separate machine-to-machine
  secret before the runner can spend any of them either.
- Protect the hosted service from SSRF: a URL is validated syntactically at
  submission time and, more importantly, with DNS resolution before every
  navigation and every redirect.
- Make local development exercise the hosted UX — and the real job-execution
  code path — end to end without a real Cloudflare account.

## 3. Non-Goals

- Proving WCAG conformance. Automated results must still be manually reviewed.
- Dynamic OAuth client registration.
- A multi-tenant organization model.
- A Worker-native audit runner. The compatibility spike's own findings (see
  `docs/hosted-mvp.md`) are why the hosted runner is a standalone Node
  process instead — this is treated as decided, not still open.
- Screenshots, traces, multi-page crawling, or any new accessibility engine.

## 4. Repository Layout

| Path                         | Responsibility                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                   | Static Astro web UI: sign-in gate, dashboard (submit + real progress + recent audits), report view.                                                                                                           |
| `apps/worker`                | Cloudflare Worker: public API, runner-only API (`/api/runner/*`), local Node development API, auth routes, D1/R2/Queue bindings. Sole owner of persistence.                                                   |
| `apps/runner`                | Standalone Node process: claims jobs from Cloudflare Queues, executes them via `@ally/runner-core`, reports state to the Worker. No D1/R2 access. Docker-deployable.                                          |
| `apps/report`                | Existing static report generation surface for CLI/local artifacts.                                                                                                                                            |
| `packages/core`              | Shared audit result model, scoring, finding normalization concepts, WCAG metadata, and the generic `AuditHooks` progress-observer model.                                                                      |
| `packages/audit-runner`      | Engine composition that runs multiple adapters and produces an `AuditRun`.                                                                                                                                    |
| `packages/engine-*`          | Engine-specific adapters for axe-core, IBM Equal Access, Alfa, and QualWeb.                                                                                                                                   |
| `packages/analyzer-keyboard` | Keyboard interaction analyzer.                                                                                                                                                                                |
| `packages/browser`           | Browser/session helpers used by local Playwright execution.                                                                                                                                                   |
| `packages/net-guard`         | SSRF protection: portable syntactic checks plus a Node-only DNS-aware guard and Playwright navigation guard.                                                                                                  |
| `packages/runner-core`       | Environment-agnostic hosted-job execution (`executeAuditJob`): claim → run → persist/fail, behind `RunnerPersistencePort`/`BrowserProvider`. Used by both `apps/runner` and `apps/worker`'s local-dev server. |
| `packages/reporter-json`     | JSON serialization and raw artifact naming.                                                                                                                                                                   |
| `docs`                       | Hosted MVP notes, OpenAPI contract, auth registration prompt, and this SDD.                                                                                                                                   |

## 5. System Context

```text
Browser
  -> apps/web static Astro UI
  -> apps/worker HTTP API at /api/*      (control plane: D1, R2, auth)
  -> D1 audit metadata
  -> Cloudflare Queue (HTTP pull consumer)
  -> apps/runner (execution plane, standalone Node process)
  -> shared @ally/runner-core + @ally/audit-runner packages
  -> local Playwright Chromium
  -> apps/worker /api/runner/* (ALLY_RUNNER_SECRET)
  -> R2 audit artifacts, written by the Worker only
```

Authentication context:

```text
Browser
  -> Ally /api/auth/login
  -> dev-auth /api/auth/oauth2/authorize
  -> Ally /api/auth/callback
  -> dev-auth discovery, token, JWKS, and userinfo endpoints
  -> Ally signed app session cookie
```

`dev-auth` remains a separate identity provider. Ally creates and validates its
own session; it does not reuse the provider session cookie. The runner's trust
relationship with the Worker is entirely separate from this — see §9.

## 6. HTTP API

The source-of-truth contract lives in `docs/openapi.yaml`.

User-facing routes (session-protected unless noted):

- `GET /api/auth/session` — public
- `GET /api/auth/login` — public
- `GET /api/auth/callback` — public
- `POST /api/auth/logout` — public
- `POST /api/audits`
- `GET /api/audits` — list the caller's own recent audits
- `GET /api/audits/:id`
- `GET /api/audits/:id/result`
- `GET /api/compatibility?url=...`

Runner-only routes (bearer `ALLY_RUNNER_SECRET`, never a user session):

- `POST /api/runner/audits/:id/claim`
- `POST /api/runner/audits/:id/running`
- `POST /api/runner/audits/:id/stage`
- `POST /api/runner/audits/:id/persisting`
- `POST /api/runner/audits/:id/complete`
- `POST /api/runner/audits/:id/fail`

The API allows credentialed CORS from the configured web origin so local
development can cross ports. Production uses `https://ally.andersseen.dev/api/*`
under the same site origin. CORS is not applied to the runner-only routes —
they are never called from a browser.

The audit and compatibility routes require `ally_session`. Auth endpoints remain
public so a browser can start and complete login. Protected routes fail closed:
missing sessions return `401`, and missing auth secrets return `503`. Runner
routes fail closed the same way against a missing/incorrect `ALLY_RUNNER_SECRET`.

## 7. Data Design

D1 table `audits` stores job and result metadata:

- `id`: UUID primary key.
- `url`: normalized audited URL.
- `status`: `queued`, `claimed`, `running`, `persisting`, `completed`,
  `failed`, `timed_out`, or `cancelled` — see §8's state machine.
- `current_stage`: `"<engine-id-or-keyboard>:<started|ok|failed>"`, updated
  live so the dashboard can show real per-engine progress.
- `attempt`: incremented on every re-claim; capped by `AUDIT_MAX_ATTEMPTS`.
- `created_at`, `updated_at`, `started_at`, `completed_at`: lifecycle timestamps.
- `last_error`: public failure message when status is a failure state — never
  a stack trace or internal detail.
- `runner_id`: which runner instance last claimed the row, for debugging.
- `score`, `score_version`, `unique_findings`, `raw_findings`,
  `keyboard_warnings`, `engines_succeeded`, `engines_configured`,
  `engines_failed`: summary fields copied from the completed `AuditResult`.
- `artifact_key`: R2 key for `audit.json`.
- `owner_user_id`, `owner_email`: user summary from dev-auth userinfo. Status and
  result reads filter by `owner_user_id`, so another authenticated user cannot
  fetch an audit by guessing its UUID.

R2 stores:

- `audits/{id}/audit.json`: normalized shared `AuditResult`.
- `audits/{id}/raw/{engine}.json`: raw engine artifacts.

Both are written only by the Worker's `POST /api/runner/audits/:id/complete`
handler, and only once — on the single successful completion call, directly
to the final keys. A retried attempt that fails never partially overwrites a
previously-completed artifact, because it never reaches `complete` at all
(the state machine only allows `complete` from `persisting`, which only a
genuinely-in-progress attempt reaches).

The local development API keeps audit rows in an in-memory `Map` (see
`apps/worker/src/local-dev.ts`) using the same transition rules from
`audit-state.ts`, and holds completed `AuditResult`s in memory rather than
writing them to a filesystem.

## 8. Execution Design

### One pipeline, three callers

```text
Local CLI              apps/runner            local-dev.ts
     │                      │                      │
     └── @ally/browser      └── PlaywrightChromium- └── same provider
                                 BrowserProvider
                              (packages/runner-core)
              \                 |                  /
               \                |                 /
                -----> @ally/audit-runner <-------
```

`packages/runner-core`'s `executeAuditJob(job, ports)` is the only place that
knows how a hosted job is executed. `RunnerPersistencePort` and
`BrowserProvider` are the two seams: `apps/runner` implements them against
Cloudflare Queues/the Worker HTTP API/local Chromium; `local-dev.ts`
implements them against an in-memory map and the same local Chromium
provider. Neither implementation duplicates engine or scoring logic.

### Hosted Worker (control plane)

The Worker's only entrypoint is `fetch`. It validates requests, reads/writes
D1 metadata, enqueues audit jobs onto the Cloudflare Queue producer binding,
serves completed artifacts from R2, and exposes the runner-only
`/api/runner/*` surface the standalone runner uses to report state. The
Worker does not execute audits itself in production — `GET
/api/compatibility` remains as a diagnostic proving why, using Cloudflare
Browser Run directly, independent of the job queue.

### apps/runner (execution plane)

A standalone Node process (`apps/runner/src/main.ts`): pull a batch of one
message from the Cloudflare Queue's HTTP pull-consumer API, run
`executeAuditJob`, ack or retry the queue message based on the outcome, loop.
`SIGTERM`/`SIGINT` stop the loop between jobs (never mid-job) and let an
in-flight audit finish, bounded by `ALLY_AUDIT_TIMEOUT_MS`.

### Local Development

`pnpm dev` runs a hybrid local stack, unchanged in shape from before this
milestone:

```text
Astro web UI (:4321)
  -> Node audit API (:8787)
  -> local Playwright + @ally/runner-core's executeAuditJob
  -> shared Ally audit packages
```

This exercises the real runner code path (claim → stage events →
complete/fail) without a real Cloudflare account, and doubles as the harness
the hosted-flow integration test drives over real HTTP.

### Job State Machine

```text
queued -> claimed -> running -> persisting -> completed
   |         |    \      |    \       \
   |         |     \     |     \       -> failed / timed_out
   |         |      \    |      -> failed / timed_out
   +---------+-------+---+
   cancel (queued/claimed/running only)
```

`claim` is legal from `queued`, `claimed`, or `running` — that's what makes
at-least-once queue redelivery safe. Every other transition is legal from
exactly the states that make sense (see `apps/worker/src/audit-state.ts`),
and every terminal state (`completed`, `failed`, `timed_out`, `cancelled`)
rejects all further transitions. `attempt` increments on every claim and is
capped by `AUDIT_MAX_ATTEMPTS`.

### Compatibility Spike

`GET /api/compatibility?url=...` tests each adapter against the Worker
Browser Run runtime and returns whether it ran directly, plus dependency
notes. Historically the decision gate between a Worker-native runner and a
hybrid Node runner; now a standing diagnostic recording why the hybrid
architecture was chosen.

## 9. Authentication Design

### User sessions (DevAuth)

Ally is a confidential OIDC client of DevFlare `dev-auth`.

Configuration:

- `DEV_AUTH_URL`
- `DEV_AUTH_CLIENT_ID`
- `DEV_AUTH_CLIENT_SECRET`
- `DEV_AUTH_REDIRECT_URI`
- `ALLY_SESSION_SECRET`
- `PUBLIC_WEB_ORIGIN`

Flow:

1. Browser opens `GET /api/auth/login`.
2. Ally creates `state`, PKCE verifier, nonce, and an `ally_oauth_tx` transaction
   cookie.
3. Ally reads provider discovery and redirects to the dev-auth authorize endpoint.
4. dev-auth redirects to `GET /api/auth/callback`.
5. Ally validates `state` and the RFC 9207 `iss` callback parameter.
6. Ally exchanges the code server side with PKCE and client secret.
7. Ally verifies the ES256 ID token against dev-auth JWKS, checking `iss`,
   `aud`, `exp`, and `nonce`, then fetches userinfo and confirms the same `sub`.
8. Ally discards provider tokens and sets a signed `ally_session` cookie
   containing user summary and expiry.
9. `GET /api/auth/session` reads only the Ally cookie.

Audit creation, listing, polling, result retrieval, and compatibility checks
require this session. The browser root route is an auth gate; `/dashboard`
contains the audit form and redirects back to `/` unless `GET
/api/auth/session` confirms a valid session.

### Runner authentication (machine-to-machine)

Entirely separate from the above: the standalone runner presents
`Authorization: Bearer <ALLY_RUNNER_SECRET>` to every `/api/runner/*` call,
verified with a constant-time comparison
(`apps/worker/src/runner-auth.ts`). This never goes through DevAuth, is
rotatable independently (`wrangler secret put ALLY_RUNNER_SECRET`), and fails
closed (503) if unset rather than allowing requests through.

Separately again: the runner authenticates to Cloudflare's own Queues REST
API with a Cloudflare API token scoped to Queues, for pulling and
acknowledging messages. Three independent credentials exist by design: user
session, runner-to-Worker secret, runner-to-Cloudflare token.

## 10. Security Considerations

- **SSRF.** `@ally/net-guard` is the reusable guard. The Worker runs its
  portable, DNS-free check (`assertSyntacticallyPublicUrl`) at submission
  time as a cheap best-effort rejection. The runner runs the full DNS-aware
  check (`assertPublicUrl`) before the first navigation and, through a
  Playwright route handler, on every redirect — the actual enforcement
  point, since that's where a real network request happens. Both fail
  closed on any ambiguity or DNS failure. An explicit, narrow
  `allowHostnames` exemption (never covering protocol/credential checks)
  exists for a deliberately configured exception; it is unset by default and
  is what lets the hosted-flow integration test exercise the real guarded
  pipeline against a local fixture server.
- Audit URLs are restricted to absolute `http` or `https` URLs; credentials
  in the URL are rejected.
- OAuth `returnTo` accepts only same-site paths to avoid open redirects.
- OAuth code flow uses PKCE S256, `state`, `nonce`, discovery, callback issuer
  validation, and ID token verification.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- CORS uses an allowlist and `Access-Control-Allow-Credentials: true`, and is
  not applied to the runner-only routes.
- Every hosted audit route requires ownership: `GET/POST /api/audits*`
  filter by `owner_user_id` in the SQL query itself, not in application
  logic after the fact, so there is no code path that can accidentally
  return another user's row.
- Secrets must be stored as Worker secrets, the runner's own environment, or
  local `.dev.vars`/`.env` — never in tracked config. Three independent
  secrets exist (session, runner-to-Worker, runner-to-Cloudflare); none
  double as another.
- Runner failure messages are pre-classified into a small `FailureCategory`
  set (`packages/runner-core/src/errors.ts`) with hand-written, safe public
  messages — raw exception text and stack traces never reach D1's
  `last_error` or the browser.
- Time/resource budgets (`ALLY_NAVIGATION_TIMEOUT_MS`, `ALLY_AUDIT_TIMEOUT_MS`,
  `ALLY_MAX_REDIRECTS`, `AUDIT_MAX_ATTEMPTS`) bound how long and how many
  times a broken or malicious target can consume the runner. Browser/context
  cleanup happens in `@ally/browser`'s existing `finally`, guaranteed even
  on failure.
- The hosted audit service still opens arbitrary public URLs in a browser.
  Production hardening still needs per-user quotas, rate limits, and abuse
  detection before broad exposure — see `docs/cloudflare-deployment.md` §9.

## 11. Observability

Structured JSON log lines carry `auditId`, `attempt`, `stage`, and
`durationMs` where relevant (`packages/runner-core/src/logging.ts`), emitted
at: job claimed, browser creating, navigation completed, each engine
started/completed/failed, keyboard completed/failed, artifact persisted,
audit completed/failed, plus queue pull/ack/retry failures and runner
shutdown in `apps/runner`.

Next production observability should add aggregated audit duration, queue
latency, per-engine duration distributions, success rate, and correlation
IDs across the Worker request and the runner's execution of the same job —
external log aggregation is out of scope for this milestone.

## 12. Deployment

Worker configuration lives in `apps/worker/wrangler.jsonc`.

Cloudflare resources:

- Browser Run binding: `BROWSER` (compatibility spike only)
- D1 binding: `DB`
- R2 binding: `ARTIFACTS`
- Queue producer binding: `AUDIT_QUEUE`
- Queue consumer: HTTP pull (`wrangler queues consumer http add`), consumed
  externally by `apps/runner`, not by the Worker

The runner (`apps/runner`) deploys as a Docker image
(`apps/runner/Dockerfile`) to any Docker host — Coolify, Fly.io, Railway,
Cloud Run, or a bare VM — independent of Cloudflare's deploy pipeline. See
`docs/cloudflare-deployment.md` for the full sequence.

Before production deployment, replace placeholder resource IDs and register the
exact Ally callback URL in `dev-auth`. The prompt in
`docs/dev-auth-client-registration-prompt.md` captures that separate repo task.

## 13. Testing Strategy

Current checks:

- `pnpm check` (format, lint, typecheck, unit tests, build, Playwright report
  E2E) across every workspace package, including the new ones.
- `packages/net-guard`: a large SSRF unit suite — every category in
  `docs/hosted-mvp.md`'s SSRF section, including literal decimal/hex/octal
  IPv4 obfuscation and IPv4-mapped IPv6.
- `packages/runner-core`: `execute-job.test.ts` exercises the real
  `@ally/audit-runner`/`@ally/core` pipeline against a fake page, proving
  orchestration (claim → stage events → persisting → complete/fail) without
  needing a real browser.
- `apps/worker`: `audit-state.test.ts` (full transition matrix),
  `runner-auth.test.ts`, and `hosted-flow.test.ts` — a Vitest integration
  test that starts the real local-dev HTTP server and
  `packages/fixtures`' static server, submits a fixture page through the
  real guarded pipeline, polls to completion, asserts a known finding, and
  asserts a second user gets 404 for the same audit id.
- `apps/runner`: `config.test.ts`, `queue-client.test.ts`,
  `worker-client.test.ts` — env validation and the exact HTTP requests each
  makes, with `fetch` mocked.

Recommended next tests:

- A live round trip against a real Cloudflare Queue and account (the pull
  consumer's exact REST response envelope is parsed defensively in
  `apps/runner/src/queue-client.ts` but has not been verified against a real
  account from this environment).
- Contract check that OpenAPI route paths match Worker routes automatically,
  rather than by review.
- Load/soak test for the runner under sustained queue throughput.

## 14. Known Risks

- The Cloudflare Queues pull-consumer REST response envelope
  (`apps/runner/src/queue-client.ts`) is parsed defensively but has not been
  confirmed against a live account; re-verify against current Cloudflare
  docs at deploy time.
- `apps/runner/Dockerfile` has not been build-tested against a real Docker
  daemon from this environment.
- Auth client registration must be done in `Andersseen/devflare` before real
  sign-in can complete.
- Production routes the static UI and `/api/*` Worker under
  `ally.andersseen.dev`; the dev-auth callback is registered exactly as
  `https://ally.andersseen.dev/api/auth/callback`.
- Report artifact schema is typed in `@ally/core` but represented loosely in
  OpenAPI until a stable public schema is generated from the TypeScript model.
- No per-user quota or rate limiting yet — an authenticated user can submit
  audits without a throughput cap.

## 15. Next Decisions

- Validate the runner Docker image and a real Cloudflare Queue round trip
  before production traffic.
- Add per-user quotas/rate limits.
- Consider extracting a shared `packages/report-ui` if `apps/report`
  (Tailwind Astro build-time components) and `apps/web`'s report rendering
  (a small `and-*` web-component runtime renderer) grow enough overlapping
  logic to justify it. Evaluated for this milestone: the only real overlap
  today is a handful of pure formatting helpers
  (`apps/report/src/lib/format.ts`), the two are different rendering systems
  by design, and forcing a shared package now would be premature
  abstraction — revisit if that changes.

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
  execution.
- Keep the static web UI and Worker API under one production site origin so
  OAuth callbacks and app cookies match exactly.
- Queue long-running audits instead of performing them in the request path.
- Persist audit metadata in D1 and complete artifacts in R2.
- Prepare app-owned sessions through DevFlare `dev-auth` without coupling Ally
  to the provider's cookies or database.
- Require authentication before any hosted audit route can spend Cloudflare
  Browser Run, Queues, D1, or R2 resources.
- Make local development exercise the hosted UX end to end, even while some
  adapters are not Worker-native yet.

## 3. Non-Goals

- Proving WCAG conformance. Automated results must still be manually reviewed.
- Dynamic OAuth client registration.
- A multi-tenant organization model.
- A final production audit runner architecture. The Worker-native runner remains
  behind a compatibility spike until adapters are Worker-compatible or moved to a
  hybrid Node runner.

## 4. Repository Layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | Static Astro web UI for submitting audits and reading hosted reports. |
| `apps/worker` | Cloudflare Worker API, queue consumer, local Node development API, auth routes, D1/R2/Queue bindings. |
| `apps/report` | Existing static report generation surface for CLI/local artifacts. |
| `packages/core` | Shared audit result model, scoring, finding normalization concepts, WCAG metadata. |
| `packages/audit-runner` | Engine composition that runs multiple adapters and produces an `AuditRun`. |
| `packages/engine-*` | Engine-specific adapters for axe-core, IBM Equal Access, Alfa, and QualWeb. |
| `packages/analyzer-keyboard` | Keyboard interaction analyzer. |
| `packages/browser` | Browser/session helpers used by local Playwright execution. |
| `packages/reporter-json` | JSON serialization and raw artifact naming. |
| `docs` | Hosted MVP notes, OpenAPI contract, auth registration prompt, and this SDD. |

## 5. System Context

```text
Browser
  -> apps/web static Astro UI
  -> apps/worker HTTP API at /api/*
  -> D1 audit metadata
  -> Queue audit job
  -> Worker consumer or local Node runner
  -> shared @ally/audit-runner packages
  -> Browser Run or local Playwright
  -> R2 audit artifacts
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
own session; it does not reuse the provider session cookie.

## 6. HTTP API

The source-of-truth contract lives in `docs/openapi.yaml`.

Current routes:

- `GET /api/auth/session`
- `GET /api/auth/login`
- `GET /api/auth/callback`
- `POST /api/auth/logout`
- `POST /api/audits`
- `GET /api/audits/:id`
- `GET /api/audits/:id/result`
- `GET /api/compatibility?url=...`

The API allows credentialed CORS from the configured web origin so local
development can cross ports. Production uses `https://ally.andersseen.dev/api/*`
under the same site origin.

The audit and compatibility routes require `ally_session`. Auth endpoints remain
public so a browser can start and complete login. Protected routes fail closed:
missing sessions return `401`, and missing auth secrets return `503`.

## 7. Data Design

D1 table `audits` stores queue and result metadata:

- `id`: UUID primary key.
- `url`: normalized audited URL.
- `status`: `queued`, `running`, `completed`, or `failed`.
- `created_at`, `updated_at`, `started_at`, `completed_at`: lifecycle timestamps.
- `error`: public failure message when status is `failed`.
- `score`, `unique_findings`, `engines_succeeded`, `engines_configured`: summary
  fields copied from the completed `AuditResult`.
- `artifact_key`: R2 key for `audit.json`.
- `owner_user_id`, `owner_email`: user summary from dev-auth userinfo. Status and
  result reads filter by `owner_user_id`, so another authenticated user cannot
  fetch an audit by guessing its UUID.

R2 stores:

- `audits/{id}/audit.json`: normalized shared `AuditResult`.
- `audits/{id}/raw/{engine}.json`: raw engine artifacts.

The local development API keeps audit rows in memory and writes local audit
working output under `.local-audits/`.

## 8. Execution Design

### Hosted Worker

The Worker has two entrypoints:

- `fetch`: validates requests, reads/writes D1 metadata, enqueues audit jobs, and
  serves completed artifacts from R2.
- `queue`: consumes audit jobs and runs the shared `@ally/audit-runner` pipeline.

The Worker runner uses Cloudflare Browser Run through `@cloudflare/playwright`.
The current adapter matrix shows that several engines still rely on Node-style
package resolution or filesystem access, so Worker-native execution is not yet
the guaranteed production path.

### Local Development

`pnpm dev` runs a hybrid local stack:

```text
Astro web UI (:4321)
  -> Node audit API (:8787)
  -> local Playwright
  -> shared Ally audit packages
```

This path exists so the hosted UI can be tested end to end while Worker runtime
compatibility is still being proven.

### Compatibility Spike

`GET /api/compatibility?url=...` tests each adapter against the Worker Browser
Run runtime and returns whether it ran directly, plus dependency notes. This is
the decision point between a fully Worker-native runner and a hybrid Node runner.

## 9. Authentication Design

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

Audit creation, polling, result retrieval, and compatibility checks require this
session. The browser root route is an auth gate; `/dashboard` contains the audit
form and redirects back to `/` unless `GET /api/auth/session` confirms a valid
session.

## 10. Security Considerations

- Audit URLs are restricted to absolute `http` or `https` URLs.
- URL credentials are rejected.
- OAuth `returnTo` accepts only same-site paths to avoid open redirects.
- OAuth code flow uses PKCE S256, `state`, `nonce`, discovery, callback issuer
  validation, and ID token verification.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- CORS uses an allowlist and `Access-Control-Allow-Credentials: true`.
- Secrets must be stored as Worker secrets or local `.dev.vars`, not in tracked
  config.
- The hosted audit service opens arbitrary public URLs in a browser. Production
  hardening still needs quotas, rate limits, abuse detection, and account-level
  policy before broad exposure.

## 11. Observability

Current logging is structured for important Worker failures:

- request failures
- queue consumer failures
- permanent audit compatibility failures
- dev-auth token/userinfo exchange failures

Next production observability should add audit duration, queue latency, per-engine
duration, success rate, and correlation IDs across request and queue execution.

## 12. Deployment

Worker configuration lives in `apps/worker/wrangler.jsonc`.

Cloudflare resources:

- Browser Run binding: `BROWSER`
- D1 binding: `DB`
- R2 binding: `ARTIFACTS`
- Queue binding: `AUDIT_QUEUE`

Before production deployment, replace placeholder resource IDs and register the
exact Ally callback URL in `dev-auth`. The prompt in
`docs/dev-auth-client-registration-prompt.md` captures that separate repo task.

## 13. Testing Strategy

Current useful checks:

- `pnpm --filter @ally/worker run typecheck`
- `pnpm --filter @ally/web run typecheck`
- `pnpm run lint`
- `pnpm --filter @ally/web run build`
- local smoke test: `GET /api/auth/session` with web `Origin`

Recommended next tests:

- Worker route unit tests for URL validation and auth callback error branches.
- Contract check that OpenAPI route paths match Worker routes.
- Local end-to-end test for submit, poll, and report rendering.
- Auth integration test using a fake OIDC provider.

## 14. Known Risks

- Several audit adapters are not fully Worker-native yet.
- Auth client registration must be done in `Andersseen/devflare` before real
  sign-in can complete.
- Production routes the static UI and `/api/*` Worker under
  `ally.andersseen.dev`; the dev-auth callback is registered exactly as
  `https://ally.andersseen.dev/api/auth/callback`.
- Report artifact schema is typed in `@ally/core` but represented loosely in
  OpenAPI until a stable public schema is generated from the TypeScript model.

## 15. Next Decisions

- Keep Cloudflare routing aligned so Pages serves the UI and the Worker owns
  `/api/*` on the registered Ally domain.
- Decide whether hosted production uses Worker-native Browser Run or a hybrid
  Node runner behind the Cloudflare API.
- Add rate limits and persistence for user-owned audit history.

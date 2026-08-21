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

The local CLI still uses `@ally/browser` with local Playwright. The hosted
Worker uses Cloudflare Browser Run through `@cloudflare/playwright` and passes a
Playwright-shaped page into the same `@ally/audit-runner` composition.

## Current Cloudflare references

- Browser Run supports browser sessions from Workers and external environments
  through Playwright, Puppeteer, or CDP:
  <https://developers.cloudflare.com/browser-run/get-started/>
- Cloudflare's Worker-compatible Playwright package is
  `@cloudflare/playwright`, currently documented as Cloudflare's fork rather
  than regular `playwright`:
  <https://developers.cloudflare.com/browser-run/playwright/>
- Cloudflare documents queue producer and consumer bindings under
  `queues.producers` and `queues.consumers` in Wrangler configuration:
  <https://developers.cloudflare.com/queues/get-started/>
- Wrangler JSON/JSONC config is current and recommended for new Worker config:
  <https://developers.cloudflare.com/workers/wrangler/configuration/>
- For compatibility dates on or after `2026-08-04`, Workers enable the current
  Node.js compatibility behavior by default, though individual APIs may still be
  partial or stubbed:
  <https://developers.cloudflare.com/workers/configuration/compatibility-flags/>

## Compatibility spike

The Worker exposes:

```http
GET /api/compatibility?url=https://example.com
```

It opens a Browser Run page and tests each engine independently. The response
records whether that adapter ran directly in the Worker, the observed error
when it did not, and static dependency notes for the adapter.

This endpoint is deliberately separate from the audit queue. It is the decision
gate between:

- **Architecture A:** Cloudflare-native audit consumer using Browser Run.
- **Architecture B:** hybrid Node runner using the same Ally packages and a
  Cloudflare-hosted API/queue/storage layer.

## Initial adapter matrix

These are code-inspection findings before running the Worker spike against a
real Browser Run binding.

| Adapter | Browser injection | Node APIs | Filesystem/package resolution | Expected Worker risk |
| --- | --- | --- | --- | --- |
| `axe-core` | Yes, via `axe.source` content | No direct Node APIs in adapter | No | Lowest risk. It injects a self-contained bundle string and evaluates in the page. |
| `IBM Equal Access` | Yes, via package bundle path | `node:module`, `node:fs/promises` | Yes, `require.resolve()` and manifest read | Medium risk. Workers with recent compatibility dates support more Node APIs, but bundling and `page.addScriptTag({ path })` must be proven. |
| `Siteimprove Alfa` | No | No direct Node APIs in adapter | No direct filesystem use | Medium/high risk. It depends on `@siteimprove/alfa-playwright` accepting a Cloudflare Playwright handle, which must be proven at runtime. |
| `QualWeb` | Yes, several package bundles | `node:module`, `node:fs/promises`, `node:path` | Yes, bundle resolution and manifest directory walking | High risk. It currently assumes package files are addressable at runtime. |
| `@ally/analyzer-keyboard` | Yes, `tabbable` UMD bundle | `node:module` | Yes, `require.resolve()` | Medium risk for the same script-path reason as IBM and QualWeb. |

## Hosted MVP pieces

- `apps/web` is a static Astro tool UI with a URL input, progress polling, and a
  report view over the stored `audit.json`.
- `apps/worker` exposes:
  - `GET /api/auth/session`
  - `GET /api/auth/login`
  - `GET /api/auth/callback`
  - `POST /api/auth/logout`
  - `POST /api/audits`
  - `GET /api/audits/:id`
  - `GET /api/audits/:id/result`
  - `GET /api/compatibility?url=...`
- D1 stores audit metadata and job status.
- R2 stores `audit.json` and raw engine artifacts.
- Cloudflare Queues decouple the HTTP request from audit execution.

## Local development runner

`pnpm dev` uses a hybrid local runner on purpose:

```text
Astro web UI (:4321)
  -> Node audit API (:8787)
  -> local Playwright
  -> shared Ally audit packages
```

That local API lives in `apps/worker/src/local-dev.ts`. It exists because the
compatibility spike showed the current engine adapters cannot all load directly
inside Workers yet. Local development should still exercise the hosted UX end to
end, so the default `@ally/worker` dev script runs the Node API.

To run the Cloudflare-native spike instead:

```bash
pnpm --filter @ally/worker run dev:worker
```

The spike is expected to report compatibility failures until the adapters stop
depending on Node-only package resolution at Worker runtime, or until the
hosted architecture moves to the hybrid Node runner described above.

The hosted report route currently renders the shared `AuditResult` artifact in
the web app. The existing `@ally/report` static Astro artifact remains unchanged
for CLI/local report generation. A later iteration can extract the report
components into a shared report package if the hosted report must exactly match
the generated static report.

## Setup notes

Replace placeholder Cloudflare resource IDs in `apps/worker/wrangler.jsonc`
before deployment:

- `d1_databases[0].database_id`
- R2 bucket name if not using `ally-audit-artifacts`
- Queue name if not using `ally-audit-jobs`

Apply the D1 schema:

```bash
pnpm --filter @ally/worker exec wrangler d1 migrations apply ally-audits
```

Run the static web app with:

```bash
PUBLIC_ALLY_API_BASE=http://127.0.0.1:8787 pnpm --filter @ally/web dev
```

Run the local hosted API with:

```bash
pnpm --filter @ally/worker dev
```

Run the Cloudflare Worker compatibility spike with:

```bash
pnpm --filter @ally/worker run dev:worker
```

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
  `https://ally-api.andersseen.dev/api/auth/callback` in production.
- `ALLY_SESSION_SECRET` or `DEV_AUTH_CLIENT_SECRET`: secret used to sign Ally's
  local app session. Store it as a Worker secret, not in `wrangler.jsonc`.

Hosted audit creation, status, results, and compatibility checks require a valid
`ally_session` cookie. The web root `/` is the sign-in gate, and `/dashboard`
contains the protected audit form. The provider client registration and
production callback still need to be applied in `Andersseen/devflare`.

# Frontend Migration

## Current Shape

Current production frontend: `apps/web` (Astro).

Candidate frontend: `apps/web-analog` (Analog.js and Angular).

Shared backend: `apps/worker` (Cloudflare Worker API).

Portable report renderer: `apps/report` (Astro).

Migration rule: Astro remains the reference implementation until an explicit cutover decision.

## Phases

Phase 1: Functional parity.

Phase 2: New product shell, accessibility, SEO, settings, and execution backend selection.

Phase 3: Cutover after validation.

## Parity Checklist

- [x] login
- [x] logout
- [x] auth redirect
- [x] dashboard
- [x] URL validation
- [x] keyboard option
- [x] recommendations option
- [x] markup option
- [x] AI review option
- [x] audit submit
- [x] progress
- [x] cancellation
- [x] errors
- [x] recent audits
- [x] reports
- [x] theme
- [x] responsive UI
- [x] accessibility
- [x] production API compatibility

## Local Development

Astro remains available on `127.0.0.1:4321`.

The Analog candidate runs on `127.0.0.1:4323` with:

```sh
pnpm dev:web:analog
```

`dev:web:analog` starts both the local Worker API on `127.0.0.1:8787` and the Analog app on
`127.0.0.1:4323`. Browser requests use the app's same-origin `/__ally_api` Vite proxy, which
rewrites to the Worker's `/api` routes.

## Deployment

The existing production deployment remains `deploy:web` and continues to publish `apps/web` to
`ally-audit-web`.

The Analog candidate has a separate optional preview deployment:

```sh
pnpm deploy:web:analog
```

It deploys `apps/web-analog/dist/client` to the separate `ally-audit-web-analog` Cloudflare Pages
project.

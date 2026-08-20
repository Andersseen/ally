# Ally

An experimental, open-source **accessibility audit orchestrator** for developers.

Ally runs several independent open-source accessibility engines against a page,
normalizes what they report into one model, and produces a developer-friendly
report. The engines do the detecting; Ally does the orchestrating, normalizing
and reporting.

> **Status: early foundation.** The monorepo, package boundaries, tooling and a
> minimal end-to-end slice exist. Most of the product does not. See
> [What is not built yet](#what-is-not-built-yet).

## What Ally does not claim

Automated testing **cannot** establish WCAG conformance. Published research and
the vendors of these engines agree that automated checks catch only a fraction
of accessibility barriers — the rest requires human judgement.

So Ally deliberately reports:

- **automated accessibility audits**, not certification;
- **findings** and **evidence**, not compliance percentages;
- **manual review required**, wherever automation cannot decide.

An audit with zero findings is not evidence that a page is accessible. Ally will
not tell you that you are "WCAG compliant", because it cannot know.

## Requirements

- Node.js 22.12 or newer
- pnpm 10

## Getting started

```bash
pnpm install
pnpm e2e:install     # one-time Chromium download for Playwright
pnpm check           # format, lint, typecheck, unit tests, build, e2e
```

Run the end-to-end slice against a real URL:

```bash
pnpm build
pnpm demo:audit https://example.com
```

That writes an audit artifact:

```text
audit/
├─ raw/
│  └─ axe-core.json    untouched engine output
└─ audit.json          normalized Ally model
```

And renders it as a static report:

```bash
ALLY_AUDIT_FILE="$PWD/audit/audit.json" pnpm --filter @ally/report build
pnpm --filter @ally/report preview
```

Without `ALLY_AUDIT_FILE`, the report builds from clearly labelled sample data,
so the UI stays buildable and testable on its own.

## Architecture

Dependencies point in one direction. The audit engine never depends on the UI.

```text
browser / engines
       ↓
      core
       ↓
 normalized audit result
       ↓
 ┌─────┴─────┐
 JSON       Astro
 reporter    report
```

| Package                | Responsibility                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| `@ally/core`           | Domain model, engine contract, orchestration. No I/O, no dependencies. |
| `@ally/browser`        | Playwright/Chromium execution and lifecycle.                           |
| `@ally/engine-axe`     | axe-core adapter. The one engine that currently runs.                  |
| `@ally/engine-ibm`     | IBM Equal Access — scaffold only.                                      |
| `@ally/engine-alfa`    | Siteimprove Alfa — scaffold only.                                      |
| `@ally/engine-qualweb` | QualWeb — scaffold only.                                               |
| `@ally/reporter-json`  | Writes `audit.json` plus per-engine raw output.                        |
| `@ally/config`         | Shared TypeScript configuration.                                       |
| `@ally/report`         | Static Astro report. Consumes the model; never runs audits.            |

Two rules keep this honest:

- **`@ally/core` knows no concrete engine.** Engines implement `AuditEngine` and
  are passed in. Core imports nothing from axe, IBM, Alfa, QualWeb, Playwright
  or Astro.
- **A failing engine is not a failing audit.** `EngineRun` is a discriminated
  union of `ok` and `failed`, so one broken engine never costs you the results
  of the others.

Raw engine output is kept beside the normalized model rather than inside it, so
`audit.json` stays small and stable no matter how verbose an engine is.

## Commands

| Command           | What it does                                 |
| ----------------- | -------------------------------------------- |
| `pnpm dev`        | Astro report in watch mode                   |
| `pnpm build`      | Build every package and the report, in order |
| `pnpm test`       | Unit tests (Vitest)                          |
| `pnpm test:e2e`   | Report smoke tests (Playwright)              |
| `pnpm typecheck`  | Type-check every package independently       |
| `pnpm lint`       | ESLint, type-aware, including `.astro`       |
| `pnpm format`     | Prettier                                     |
| `pnpm check`      | The full local quality gate                  |
| `pnpm demo:audit` | The end-to-end vertical slice                |

## Testing

Vitest covers domain models, normalizers and the reporter — everything that is
a pure function over data. Playwright covers the built report, verifying that it
builds, loads and shows the audit information. Unit tests are not repeated at
the E2E level.

## What is not built yet

Deliberately absent, in rough order of intent: deduplication of overlapping
findings across engines, scoring, IBM/Alfa/QualWeb adapters, keyboard and focus
analysis, accessibility-tree inspection, multi-page crawling, and a real CLI.

## Licensing

Ally is licensed under the [Apache License 2.0](LICENSE).

The accessibility engines Ally orchestrates are **separate projects under their
own licenses** — MPL-2.0, Apache-2.0, MIT and ISC respectively. Ally consumes
them as dependencies and does not vendor or relicense their source. See
[NOTICE](NOTICE).

# Ally

An experimental, open-source **accessibility audit orchestrator** for developers.

Ally runs several independent open-source accessibility engines against a page,
normalizes what they report into one model, deduplicates their overlapping
findings, and produces a developer-friendly report. The engines do the
detecting; Ally does the orchestrating, normalizing, deduplicating and
reporting.

> **Status: Level 1 — a usable personal auditing MVP.** Four engines run, a
> keyboard analyzer runs, findings are deduplicated and scored, and the whole
> thing renders as one static report. See
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
not tell you that you are "WCAG compliant", because it cannot know. The one
number it does produce is called the **Automated Accessibility Score**, and the
report states what it is not every time it shows it.

## Requirements

- Node.js 22.12 or newer
- pnpm 10

## Getting started

```bash
pnpm install
pnpm e2e:install     # one-time Chromium download for Playwright
pnpm check           # format, lint, typecheck, unit tests, build, e2e
```

Audit a page:

```bash
pnpm build
pnpm ally https://example.com
```

> `pnpm audit` is a built-in pnpm command and cannot be shadowed by a workspace
> script, so Ally's command is `pnpm ally`. Inside a package you can also run
> the binary directly: `pnpm exec ally https://example.com`.

That runs the whole pipeline and prints a summary:

```text
Auditing https://example.com/ …
  ✓ axe-core            2 findings
  ✓ IBM Equal Access    3 findings
  ✓ Siteimprove Alfa    4 findings
  ✓ QualWeb             3 findings
  ✓ keyboard            1 tab stops, 0 warnings

Ally audit complete

  URL                 https://example.com/
  Score               56 / 100  (Automated Accessibility Score v1)
  Engines             4/4
  Raw findings        12
  Unique findings     12
  Keyboard warnings   0

Report
  ./audit/report/index.html
```

And writes one audit artifact:

```text
audit/
├─ raw/
│  ├─ axe-core.json           untouched engine output
│  ├─ ibm-equal-access.json
│  ├─ alfa.json
│  ├─ qualweb.json
│  └─ keyboard.json
├─ audit.json                 normalized, deduplicated, scored Ally model
└─ report/
   └─ index.html              static Astro report
```

### Options

| Flag             | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `--out <dir>`    | Where to write the artifact (default `./audit`) |
| `--only <ids>`   | Run only these engines, comma-separated         |
| `--no-keyboard`  | Skip the keyboard/focus analysis                |
| `--no-report`    | Write the artifact but do not build the report  |
| `--headed`       | Run Chromium with a visible window              |
| `--timeout <ms>` | Navigation and interaction timeout              |

## The pipeline

```text
URL
 ↓  @ally/browser        launch Chromium, navigate
 ↓  engines              axe-core · IBM Equal Access · Alfa · QualWeb
 ↓  @ally/analyzer-keyboard   press Tab, observe focus
 ↓  normalize            each adapter → one shared finding model
 ↓  deduplicate          one problem, one finding, many sources
 ↓  score                Automated Accessibility Score
 ↓  @ally/reporter-json  audit.json + raw/
 ↓  @ally/report         static Astro report
```

A failing engine never fails the audit. `EngineRun` is a discriminated union of
`ok` and `failed`, the failure is recorded with its message and duration, and
the report shows it. A crashed engine reduces _coverage_; it never becomes a
finding and never lowers the score.

## Architecture

Dependencies point in one direction. The audit core never depends on the UI, and
never on a concrete engine.

| Package                   | Responsibility                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `@ally/core`              | Domain model, engine contract, dedup, scoring. No dependencies.   |
| `@ally/browser`           | Playwright/Chromium lifecycle and shared in-page DOM helpers.     |
| `@ally/engine-axe`        | axe-core adapter.                                                 |
| `@ally/engine-ibm`        | IBM Equal Access adapter.                                         |
| `@ally/engine-alfa`       | Siteimprove Alfa adapter.                                         |
| `@ally/engine-qualweb`    | QualWeb adapter.                                                  |
| `@ally/analyzer-keyboard` | Ally's own keyboard/focus analyzer.                               |
| `@ally/reporter-json`     | Writes `audit.json` plus per-engine raw output.                   |
| `@ally/cli`               | `ally <url>` — argument parsing, orchestration, summary.          |
| `@ally/fixtures`          | Local benchmark pages with known problems, and a server for them. |
| `@ally/config`            | Shared TypeScript configuration.                                  |
| `@ally/report`            | Static Astro report. Consumes the model; never runs audits.       |

Two naming rules carry meaning:

- **`engine-*` is a third-party engine**, wrapped in an adapter. Every concrete
  third-party type stays inside its adapter package.
- **`analyzer-*` is Ally's own**, and _drives_ the browser rather than
  inspecting a snapshot. The report keeps them apart, because they answer
  different questions and fail in different ways.

And two structural rules keep it honest:

- **`@ally/core` knows no concrete engine.** It imports nothing from axe, IBM,
  Alfa, QualWeb, Playwright, tabbable or Astro. Engines implement `AuditEngine`
  and are passed in.
- **Normalizers are pure.** `run()` touches the browser; `normalize()` is a pure
  function over serializable output, so every normalizer is unit-tested against
  recorded engine responses with no browser at all.

### Canonical element paths

Deduplication has to answer "did two engines find this on the same element?",
and every engine answers "where?" differently — axe returns a CSS selector,
QualWeb an `:nth-child` chain, IBM an XPath, Alfa a path into its own DOM copy.

Ally normalizes all of them onto one form:

```text
/html[1]/body[1]/main[1]/p[2]
```

Adapters that report selectors resolve them in the page, through one shared
helper in `@ally/browser`, so every adapter computes the identical path. Alfa's
paths address text nodes, so the trailing `text()[n]` step is dropped — which is
what lets Alfa's finding about the text inside a paragraph line up with axe's
finding about the paragraph.

## Deduplication

Two findings are merged only when they share a rule family, resolve to the same
element, make compatible claims about WCAG, and classify the rule the same way.

| Confidence | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `exact`    | The engines cited exactly the same criteria.    |
| `probable` | Their criteria overlap but are not identical.   |
| `none`     | Nothing merged — a single engine reported this. |

Findings with no element path are never merged. Findings whose criteria are
disjoint are never merged. A WCAG finding is never merged with a best-practice
one. **A false merge hides a real problem; a missed merge only costs a duplicate
row**, so Ally errs towards leaving findings apart.

Every merged finding keeps each source's own rule id, severity and message as
evidence, and reports how many engines agreed.

## Automated Accessibility Score

Deterministic, documented, versioned and reproducible — and rendered in the
report alongside the arithmetic that produced it.

```text
weight  = severity weight × classification multiplier
group   = one rule family + one criterion set
cost    = weight × (1 + ln(findings in group))
score   = round(100 × 40 / (40 + Σ cost))
```

| Severity   | Weight |     | Classification | Multiplier |
| ---------- | -----: | --- | -------------- | ---------: |
| `critical` |     10 |     | WCAG           |         ×1 |
| `serious`  |      6 |     | Unclassified   |       ×0.7 |
| `moderate` |      3 |     | Best practice  |       ×0.4 |
| `minor`    |      1 |     |                |            |
| `info`     |      0 |     |                |            |

The design constraints matter more than the constants:

- **100 does not mean WCAG conformant.** It means no engine reported a problem.
- **Duplicates are charged once**, because scoring runs on deduplicated findings.
- **Adding an engine cannot lower the score on its own** — only genuinely new
  problems cost anything.
- **A recurring problem is charged once**, with logarithmic growth: sixty
  low-contrast paragraphs are one problem repeated, not sixty problems.
- **Engine failures reduce coverage, not the score.**

## Keyboard analysis

`@ally/analyzer-keyboard` is Ally's first analyzer that is not a static engine.
It determines the expected sequential focus order with
[`tabbable`](https://github.com/focus-trap/tabbable), then presses Tab and
Shift+Tab in Chromium and records where focus actually lands.

It reports positive `tabindex` values, tabbable elements the traversal never
reached, stops nothing predicted, focus landing on `<body>`, and repeating focus
cycles — classified as a **potential** keyboard trap, because a modal dialog may
cycle focus on purpose.

Every traversal is bounded: a Tab-press budget, a Shift+Tab budget, a timeout
and repeated-state detection. A traversal that ended early says so rather than
presenting a truncated sequence as complete.

It only navigates. It does not click, and does not press Enter, Space or Escape.

## Commands

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `pnpm ally <url>` | Audit a page and build its report                   |
| `pnpm dev`        | Astro report in watch mode                          |
| `pnpm build`      | Build every package and the report, in order        |
| `pnpm test`       | Unit tests (Vitest)                                 |
| `pnpm test:e2e`   | Build fixtures audits, then Playwright report tests |
| `pnpm typecheck`  | Type-check every package independently              |
| `pnpm lint`       | ESLint, type-aware, including `.astro`              |
| `pnpm format`     | Prettier                                            |
| `pnpm check`      | The full local quality gate                         |

## Testing

Vitest covers everything that is a pure function over data: severity and WCAG
normalization, canonical paths, every engine normalizer, deduplication, scoring,
keyboard sequence analysis and cycle detection, CLI parsing and the reporter.
Engine normalizers run against **real captured engine responses** in
`packages/engine-*/src/__fixtures__`, recorded by
`node scripts/capture-fixtures.ts`. No unit test launches a browser.

Playwright covers the built report. `scripts/prepare-e2e.ts` runs the real
pipeline against local fixture pages and produces two artifacts — one healthy,
one where an engine deliberately failed and the page traps focus — then builds
both reports. The tests assert the page against the artifact it was built from,
so they test the report rather than the engines.

Ally also audits its own report with its own axe adapter, and fails if the
report has any moderate-or-worse violation. That check has already caught one
real bug.

### Benchmark fixtures

`packages/fixtures/pages` holds small local pages with known problems, served
over HTTP on an ephemeral port:

```text
accessible.html      a control — should produce few or no findings
missing-label.html   images, buttons and controls with no accessible name
contrast.html        text and a button below the contrast thresholds
tabindex.html        positive tabindex values and an off-screen control
keyboard-cycle.html  focus cycled between three controls, unable to leave
```

Public websites change without warning; these do not. When a fixture audit
changes, Ally changed.

## What is not built yet

Deliberately absent, in rough order of intent: activation behaviour (Enter,
Space, Escape), modal and widget interaction, focus restoration,
accessibility-tree inspection, custom rules, multi-page crawling, authenticated
audits, and any hosted or CI service.

## Licensing

Ally is licensed under the [Apache License 2.0](LICENSE).

The accessibility engines Ally orchestrates are **separate projects under their
own licenses** — MPL-2.0, Apache-2.0, MIT and ISC respectively. Ally consumes
them as dependencies and does not vendor or relicense their source. See
[NOTICE](NOTICE) for what is used and why.

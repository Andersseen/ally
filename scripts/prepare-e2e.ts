/**
 * Builds the artifacts the report's end-to-end tests run against.
 *
 * The tests need a report produced by the *real* pipeline — engines, keyboard
 * analysis, deduplication and scoring — rather than a hand-written fixture,
 * because a hand-written fixture cannot catch a normalizer that stopped
 * producing element paths.
 *
 * Two audits are produced:
 *
 *   full/      every engine succeeded, many findings, several engines agreeing
 *   degraded/  one engine deliberately failed, and the page traps focus
 *
 * The degraded audit exists because a partially failed audit is a normal
 * outcome the report has to handle honestly, and that path is impossible to
 * exercise if every engine always works.
 *
 *   pnpm run e2e:prepare
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeyboardAnalyzer } from '@ally/analyzer-keyboard';
import { withPage } from '@ally/browser';
import { runAudit } from '@ally/core';
import type { AuditEngine, AuditRun } from '@ally/core';
import type { Page } from '@ally/browser';
import { selectEngines } from '@ally/cli';
import { startFixtureServer } from '@ally/fixtures';
import { writeAuditReport } from '@ally/reporter-json';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = join(repoRoot, 'apps', 'report', 'e2e', '.artifacts');

interface Scenario {
  readonly id: string;
  readonly page: string;
  /** Engine to replace with one that always throws, if any. */
  readonly failEngine?: string;
}

const SCENARIOS: readonly Scenario[] = [
  { id: 'full', page: 'missing-label.html' },
  { id: 'degraded', page: 'keyboard-cycle.html', failEngine: 'qualweb' },
];

async function main(): Promise<void> {
  await rm(artifactsRoot, { recursive: true, force: true });

  const server = await startFixtureServer();
  const runs = new Map<string, AuditRun>();

  try {
    for (const scenario of SCENARIOS) {
      const url = server.url(scenario.page);
      process.stdout.write(`Auditing ${scenario.page} for the "${scenario.id}" scenario …\n`);

      const { engines } = selectEngines([]);
      const configured = engines.map((engine) =>
        engine.id === scenario.failEngine ? alwaysFails(engine) : engine,
      );

      const run = await withPage(url, (page: Page) =>
        runAudit({
          context: { url, page },
          engines: configured,
          keyboard: createKeyboardAnalyzer(),
        }),
      );

      const artifacts = await writeAuditReport(run, { outDir: join(artifactsRoot, scenario.id) });
      runs.set(scenario.id, run);

      const { summary, score } = run.result;
      process.stdout.write(
        `  ${String(summary.totalFindings)} raw → ${String(summary.uniqueFindings)} unique, ` +
          `score ${String(score.value)}, ${String(summary.enginesFailed)} engine failure(s)\n` +
          `  ${artifacts.auditFile}\n`,
      );
    }
  } finally {
    await server.close();
  }

  for (const scenario of SCENARIOS) {
    process.stdout.write(`Building the "${scenario.id}" report …\n`);
    await buildReport(scenario.id);
  }

  process.stdout.write('\nEnd-to-end artifacts ready.\n');
}

/**
 * Wraps an engine so that it always throws.
 *
 * Only ever used here. The product CLI has no way to make an engine fail, and
 * should not: this is a test harness making a real failure path observable.
 */
function alwaysFails(engine: AuditEngine<Page>): AuditEngine<Page> {
  return {
    ...engine,
    run: () =>
      Promise.reject(
        new Error(
          `Simulated failure of ${engine.name}, so the report's engine-failure path is exercised.`,
        ),
      ),
  };
}

function buildReport(scenarioId: string): Promise<void> {
  const scenarioDir = join(artifactsRoot, scenarioId);

  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('pnpm', ['--filter', '@ally/report', 'build'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ALLY_AUDIT_FILE: join(scenarioDir, 'audit.json'),
        ALLY_REPORT_OUT_DIR: join(scenarioDir, 'report'),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    child.on('error', rejectBuild);
    child.on('close', (code) => {
      if (code === 0) resolveBuild();
      else
        rejectBuild(
          new Error(`Building the "${scenarioId}" report exited with code ${String(code)}.`),
        );
    });
  });
}

await main();

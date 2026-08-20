/**
 * Vertical-slice demo: URL → browser → axe → core → JSON artifact.
 *
 * This is not the Ally CLI. It exists to prove that the package boundaries
 * compose, end to end, before the real orchestrator is built.
 *
 *   pnpm build && pnpm demo:audit https://example.com
 */
import { resolve } from 'node:path';
import { withPage } from '@ally/browser';
import { runAudit } from '@ally/core';
import { createAxeEngine } from '@ally/engine-axe';
import { writeAuditReport } from '@ally/reporter-json';

const DEFAULT_URL = 'https://example.com';

async function main(): Promise<void> {
  const url = process.argv[2] ?? DEFAULT_URL;
  const outDir = resolve(process.cwd(), 'audit');

  console.log(`Auditing ${url} …`);

  const run = await withPage(url, (page) =>
    runAudit({
      context: { url, page },
      engines: [createAxeEngine()],
    }),
  );

  const artifacts = await writeAuditReport(run, { outDir });

  const { summary, engines } = run.result;
  console.log(
    `\n${summary.totalFindings} findings ` +
      `(${summary.bySeverity.critical} critical, ${summary.bySeverity.serious} serious, ` +
      `${summary.bySeverity.moderate} moderate, ${summary.bySeverity.minor} minor)`,
  );
  for (const engine of engines) {
    const detail =
      engine.status === 'ok'
        ? `${engine.findingCount} findings`
        : `failed — ${engine.error.message}`;
    console.log(`  ${engine.engine.name}: ${detail}`);
  }

  console.log(`\nWrote ${artifacts.auditFile}`);
  for (const rawFile of artifacts.rawFiles) {
    console.log(`Wrote ${rawFile}`);
  }
  console.log(
    `\nRender it:\n  ALLY_AUDIT_FILE=${artifacts.auditFile} pnpm --filter @ally/report build`,
  );
}

await main();

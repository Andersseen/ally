import { createKeyboardAnalyzer } from '@ally/analyzer-keyboard';
import { withPage } from '@ally/browser';
import type { Page } from '@ally/browser';
import { runAudit } from '@ally/core';
import type { AuditRun } from '@ally/core';
import { writeAuditReport } from '@ally/reporter-json';
import type { AuditArtifacts } from '@ally/reporter-json';
import { selectEngines } from './engines.js';
import type { AuditOptions } from './options.js';

export interface AuditOutcome {
  readonly run: AuditRun;
  readonly artifacts: AuditArtifacts;
  readonly unknownEngines: readonly string[];
}

/**
 * Runs one audit end to end: browser → engines → keyboard → normalize →
 * deduplicate → score → artifact.
 *
 * Everything after the browser is `@ally/core`'s job. This function only
 * assembles the parts, which is what keeps the CLI thin enough to be worth
 * having.
 */
export async function performAudit(options: AuditOptions): Promise<AuditOutcome> {
  const { engines, unknown } = selectEngines(options.only);
  const keyboard = options.keyboard ? createKeyboardAnalyzer() : undefined;

  const run = await withPage(
    options.url,
    (page: Page) =>
      runAudit({
        context: { url: options.url, page },
        engines,
        ...(keyboard === undefined ? {} : { keyboard }),
      }),
    { headless: options.headless, timeoutMs: options.timeoutMs },
  );

  const artifacts = await writeAuditReport(run, { outDir: options.outDir });

  return { run, artifacts, unknownEngines: unknown };
}

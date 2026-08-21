import { auditPage } from '@ally/audit-runner';
import { withPage } from '@ally/browser';
import type { Page } from '@ally/browser';
import type { AuditRun } from '@ally/core';
import { writeAuditReport } from '@ally/reporter-json';
import type { AuditArtifacts } from '@ally/reporter-json';
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
  const outcome = await withPage(
    options.url,
    (page: Page) =>
      auditPage({
        url: options.url,
        page,
        only: options.only,
        keyboard: options.keyboard,
      }),
    { headless: options.headless, timeoutMs: options.timeoutMs },
  );

  const artifacts = await writeAuditReport(outcome.run, { outDir: options.outDir });

  return { run: outcome.run, artifacts, unknownEngines: outcome.unknownEngines };
}

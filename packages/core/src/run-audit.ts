import { AUDIT_SCHEMA_VERSION } from './audit.js';
import type { AuditRun, AuditSummary, EngineFailure, EngineRun } from './audit.js';
import type { AuditContext, AuditEngine, EngineMetadata } from './engine.js';
import type { NormalizedFinding } from './finding.js';
import { emptySeverityCounts } from './severity.js';
import type { Severity, SeverityCounts } from './severity.js';

export interface RunAuditOptions<TPage> {
  readonly context: AuditContext<TPage>;
  readonly engines: readonly AuditEngine<TPage>[];
  /** Epoch-millisecond clock. Injectable so tests stay deterministic. */
  readonly clock?: () => number;
}

/**
 * Runs every engine against one page and assembles a normalized audit.
 *
 * The orchestrator knows nothing about any concrete engine: it only depends on
 * the {@link AuditEngine} contract. Engines that throw are recorded as failed
 * runs and the audit continues, so one broken engine never costs the results
 * of the others.
 */
export async function runAudit<TPage>(options: RunAuditOptions<TPage>): Promise<AuditRun> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();

  const engineRuns: EngineRun[] = [];
  const findings: NormalizedFinding[] = [];
  const raw = new Map<string, unknown>();

  // Sequential by design: engines share a single page and most of them inject
  // scripts into it, so running them concurrently would corrupt page state.
  for (const engine of options.engines) {
    const engineStartedAt = clock();
    const metadata = toMetadata(engine);

    try {
      const rawOutput = await engine.run(options.context);
      raw.set(engine.id, rawOutput);

      const engineFindings = engine.normalize(rawOutput);
      findings.push(...engineFindings);

      engineRuns.push({
        status: 'ok',
        engine: metadata,
        durationMs: clock() - engineStartedAt,
        findingCount: engineFindings.length,
      });
    } catch (error) {
      engineRuns.push({
        status: 'failed',
        engine: metadata,
        durationMs: clock() - engineStartedAt,
        error: toEngineFailure(error),
      });
    }
  }

  const finishedAt = clock();

  return {
    result: {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      target: { url: options.context.url },
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      engines: engineRuns,
      findings,
      summary: summarize(findings, engineRuns),
    },
    raw,
  };
}

function summarize(
  findings: readonly NormalizedFinding[],
  engineRuns: readonly EngineRun[],
): AuditSummary {
  return {
    totalFindings: findings.length,
    // Deduplication is not implemented yet; reporting a guess would be a lie.
    uniqueFindings: null,
    bySeverity: countBySeverity(findings),
    enginesSucceeded: engineRuns.filter((run) => run.status === 'ok').length,
    enginesFailed: engineRuns.filter((run) => run.status === 'failed').length,
  };
}

function countBySeverity(findings: readonly NormalizedFinding[]): SeverityCounts {
  const counts: Record<Severity, number> = { ...emptySeverityCounts() };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/** Copies identity off the engine so the result stays plain and serializable. */
function toMetadata(engine: EngineMetadata): EngineMetadata {
  return {
    id: engine.id,
    name: engine.name,
    homepage: engine.homepage,
    license: engine.license,
  };
}

function toEngineFailure(error: unknown): EngineFailure {
  if (error instanceof Error) {
    return error.stack === undefined
      ? { message: error.message }
      : { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

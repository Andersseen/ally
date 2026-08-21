import { AUDIT_SCHEMA_VERSION } from './audit.js';
import type {
  AuditCoverage,
  AuditRun,
  AuditSummary,
  EngineContribution,
  EngineFailure,
  EngineRun,
} from './audit.js';
import { dedupeFindings } from './dedupe.js';
import type { AllyFinding } from './dedupe.js';
import type { AuditContext, AuditEngine, EngineMetadata } from './engine.js';
import type { NormalizedFinding } from './finding.js';
import { summarizeKeyboard } from './keyboard.js';
import type { KeyboardAnalyzer, KeyboardReport } from './keyboard.js';
import { scoreAudit } from './score.js';
import { countBySeverity } from './severity.js';
import { RULE_STANDARDS } from './wcag.js';
import type { RuleStandard } from './wcag.js';

export interface RunAuditOptions<TPage> {
  readonly context: AuditContext<TPage>;
  readonly engines: readonly AuditEngine<TPage>[];
  /** Optional behavioural analyzer. Runs after every engine. */
  readonly keyboard?: KeyboardAnalyzer<TPage>;
  /** Epoch-millisecond clock. Injectable so tests stay deterministic. */
  readonly clock?: () => number;
}

/**
 * Runs every engine against one page and assembles a normalized audit.
 *
 * The orchestrator knows nothing about any concrete engine: it only depends on
 * the {@link AuditEngine} contract. Engines that throw are recorded as failed
 * runs and the audit continues, so one broken engine never costs the results
 * of the others — and the failure is reported rather than swallowed.
 *
 * The pipeline is: run → normalize → deduplicate → score.
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

    try {
      const output = await engine.run(options.context);
      raw.set(engine.id, output.raw);

      const engineFindings = engine.normalize(output.raw);
      findings.push(...engineFindings);

      engineRuns.push({
        status: 'ok',
        engine: toMetadata(engine, output.version),
        durationMs: clock() - engineStartedAt,
        rawFindingCount: output.rawCount,
        findingCount: engineFindings.length,
        ...(output.notes === undefined || output.notes.length === 0 ? {} : { notes: output.notes }),
      });
    } catch (error) {
      engineRuns.push({
        status: 'failed',
        engine: toMetadata(engine),
        durationMs: clock() - engineStartedAt,
        error: toEngineFailure(error),
      });
    }
  }

  const keyboard = await runKeyboard(options, clock, raw, findings);

  const deduped = dedupeFindings(findings);
  const finishedAt = clock();

  return {
    result: {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      target: { url: options.context.url },
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      engines: engineRuns,
      contributions: contributionsOf(engineRuns, deduped.findings),
      findings: deduped.findings,
      ...(keyboard === undefined ? {} : { keyboard }),
      score: scoreAudit(deduped.findings),
      coverage: coverageOf(options.engines.length, engineRuns, keyboard),
      summary: summarize(findings.length, deduped.findings, engineRuns, keyboard),
      dedupeVersion: deduped.version,
    },
    raw,
  };
}

/**
 * Runs the keyboard analyzer, if one was supplied.
 *
 * A failing analyzer is recorded exactly like a failing engine: the audit keeps
 * going and the report says what broke.
 */
async function runKeyboard<TPage>(
  options: RunAuditOptions<TPage>,
  clock: () => number,
  raw: Map<string, unknown>,
  findings: NormalizedFinding[],
): Promise<KeyboardReport | undefined> {
  const analyzer = options.keyboard;
  if (analyzer === undefined) return undefined;

  const startedAt = clock();
  try {
    const analysis = await analyzer.analyze(options.context);
    raw.set(analyzer.id, analysis);
    findings.push(...analyzer.toFindings(analysis));
    return analysis;
  } catch (error) {
    return {
      status: 'failed',
      durationMs: clock() - startedAt,
      error: toEngineFailure(error),
    };
  }
}

function summarize(
  totalFindings: number,
  unique: readonly AllyFinding[],
  engineRuns: readonly EngineRun[],
  keyboard: KeyboardReport | undefined,
): AuditSummary {
  const byStandard: Record<RuleStandard, number> = { wcag: 0, 'best-practice': 0, unknown: 0 };
  for (const standard of RULE_STANDARDS) byStandard[standard] = 0;
  for (const finding of unique) byStandard[finding.standard] += 1;

  const keyboardSummary = keyboard === undefined ? undefined : summarizeKeyboard(keyboard);

  return {
    totalFindings,
    uniqueFindings: unique.length,
    bySeverity: countBySeverity(unique),
    byStandard,
    enginesSucceeded: engineRuns.filter((run) => run.status === 'ok').length,
    enginesFailed: engineRuns.filter((run) => run.status === 'failed').length,
    ...(keyboardSummary === undefined ? {} : { keyboard: keyboardSummary }),
  };
}

/**
 * Measures what each engine added.
 *
 * "Unique" means no other engine reported the same problem — the number that
 * decides whether a fourth engine is worth its runtime.
 */
function contributionsOf(
  engineRuns: readonly EngineRun[],
  unique: readonly AllyFinding[],
): readonly EngineContribution[] {
  return engineRuns.map((run) => {
    const engineId = run.engine.id;
    const reported = unique.filter((finding) => finding.engineIds.includes(engineId));

    return {
      engineId,
      engineName: run.engine.name,
      status: run.status,
      durationMs: run.durationMs,
      rawFindings: run.status === 'ok' ? run.rawFindingCount : 0,
      normalizedFindings: run.status === 'ok' ? run.findingCount : 0,
      uniqueContributions: reported.filter((finding) => finding.engineAgreement === 1).length,
      sharedContributions: reported.filter((finding) => finding.engineAgreement > 1).length,
    };
  });
}

function coverageOf(
  configured: number,
  engineRuns: readonly EngineRun[],
  keyboard: KeyboardReport | undefined,
): AuditCoverage {
  return {
    enginesConfigured: configured,
    enginesSucceeded: engineRuns.filter((run) => run.status === 'ok').length,
    keyboardAnalysis: keyboard === undefined ? 'skipped' : keyboard.status,
  };
}

/** Copies identity off the engine so the result stays plain and serializable. */
function toMetadata(engine: EngineMetadata, version?: string): EngineMetadata {
  const resolved = version ?? engine.version;

  return {
    id: engine.id,
    name: engine.name,
    homepage: engine.homepage,
    license: engine.license,
    ...(resolved === undefined ? {} : { version: resolved }),
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

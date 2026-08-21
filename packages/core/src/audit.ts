import type { AllyFinding } from './dedupe.js';
import type { EngineMetadata } from './engine.js';
import type { KeyboardReport, KeyboardSummary } from './keyboard.js';
import type { AutomatedScore } from './score.js';
import type { SeverityCounts } from './severity.js';
import type { RuleStandard } from './wcag.js';

/**
 * Version of the `audit.json` document shape.
 * Bump whenever a change would break existing consumers of the artifact.
 */
export const AUDIT_SCHEMA_VERSION = 2;

/** A serializable description of why something failed. */
export interface EngineFailure {
  readonly message: string;
  readonly stack?: string;
}

/**
 * Outcome of one engine within an audit.
 *
 * Modelled as a discriminated union so that a single failing engine is
 * representable without failing the whole audit — and so that a reader of the
 * artifact cannot mistake "did not run" for "found nothing".
 */
export type EngineRun =
  | {
      readonly status: 'ok';
      readonly engine: EngineMetadata;
      readonly durationMs: number;
      /** Results the engine itself reported, before normalization. */
      readonly rawFindingCount: number;
      /** Findings after translation into Ally's model. */
      readonly findingCount: number;
    }
  | {
      readonly status: 'failed';
      readonly engine: EngineMetadata;
      readonly durationMs: number;
      readonly error: EngineFailure;
    };

/**
 * What one engine added to the audit.
 *
 * Ally's premise is that several engines are worth running. These numbers are
 * how that premise gets tested rather than assumed — they are collected, not
 * acted upon.
 */
export interface EngineContribution {
  readonly engineId: string;
  readonly engineName: string;
  readonly status: 'ok' | 'failed';
  readonly durationMs: number;
  readonly rawFindings: number;
  readonly normalizedFindings: number;
  /** Unique findings only this engine reported. */
  readonly uniqueContributions: number;
  /** Unique findings this engine reported alongside at least one other. */
  readonly sharedContributions: number;
}

export interface AuditSummary {
  /** Findings across all sources, before deduplication. */
  readonly totalFindings: number;
  /** Findings remaining after cross-engine deduplication. */
  readonly uniqueFindings: number;
  readonly bySeverity: SeverityCounts;
  readonly byStandard: Readonly<Record<RuleStandard, number>>;
  readonly enginesSucceeded: number;
  readonly enginesFailed: number;
  readonly keyboard?: KeyboardSummary;
}

/**
 * How much of the intended audit actually ran.
 *
 * Kept apart from the score on purpose: an engine that crashed is missing
 * evidence, not evidence of a problem, and must never look like one.
 */
export interface AuditCoverage {
  readonly enginesConfigured: number;
  readonly enginesSucceeded: number;
  readonly keyboardAnalysis: 'ok' | 'failed' | 'skipped';
}

/** What was audited. */
export interface AuditTarget {
  readonly url: string;
}

/**
 * The normalized, JSON-serializable result of one audit.
 * This is the single model every reporter consumes.
 */
export interface AuditResult {
  readonly schemaVersion: number;
  readonly target: AuditTarget;
  /** ISO-8601 timestamp. */
  readonly startedAt: string;
  /** ISO-8601 timestamp. */
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly engines: readonly EngineRun[];
  readonly contributions: readonly EngineContribution[];
  /** Deduplicated findings, most urgent first. */
  readonly findings: readonly AllyFinding[];
  readonly keyboard?: KeyboardReport;
  readonly score: AutomatedScore;
  readonly coverage: AuditCoverage;
  readonly summary: AuditSummary;
  readonly dedupeVersion: number;
}

/**
 * An audit together with the untouched engine output that produced it.
 *
 * Raw output is kept beside the normalized result rather than inside it, so
 * that `audit.json` stays small and stable while `raw/<engine>.json` can hold
 * whatever shape each engine emits.
 */
export interface AuditRun {
  readonly result: AuditResult;
  readonly raw: ReadonlyMap<string, unknown>;
}

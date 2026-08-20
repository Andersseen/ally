import type { EngineMetadata } from './engine.js';
import type { NormalizedFinding } from './finding.js';
import type { SeverityCounts } from './severity.js';

/**
 * Version of the `audit.json` document shape.
 * Bump whenever a change would break existing consumers of the artifact.
 */
export const AUDIT_SCHEMA_VERSION = 1;

/** A serializable description of why an engine failed. */
export interface EngineFailure {
  readonly message: string;
  readonly stack?: string;
}

/**
 * Outcome of one engine within an audit.
 *
 * Modelled as a discriminated union so that a single failing engine is
 * representable without failing the whole audit.
 */
export type EngineRun =
  | {
      readonly status: 'ok';
      readonly engine: EngineMetadata;
      readonly durationMs: number;
      readonly findingCount: number;
    }
  | {
      readonly status: 'failed';
      readonly engine: EngineMetadata;
      readonly durationMs: number;
      readonly error: EngineFailure;
    };

export interface AuditSummary {
  /** Findings across all engines, before any deduplication. */
  readonly totalFindings: number;
  /**
   * Findings remaining after cross-engine deduplication.
   * `null` until deduplication is implemented — never guessed.
   */
  readonly uniqueFindings: number | null;
  readonly bySeverity: SeverityCounts;
  readonly enginesSucceeded: number;
  readonly enginesFailed: number;
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
  readonly findings: readonly NormalizedFinding[];
  readonly summary: AuditSummary;
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

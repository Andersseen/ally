/**
 * Public API of `@ally/core`.
 *
 * Curated on purpose: everything exported here is something another package is
 * meant to depend on. Internals stay unexported so boundaries remain visible.
 */
export { AUDIT_SCHEMA_VERSION } from './audit.js';
export type {
  AuditResult,
  AuditRun,
  AuditSummary,
  AuditTarget,
  EngineFailure,
  EngineRun,
} from './audit.js';

export type {
  AuditContext,
  AuditEngine,
  EngineDescriptor,
  EngineMetadata,
  EngineStatus,
} from './engine.js';

export { findingId } from './finding.js';
export type { Evidence, NormalizedFinding } from './finding.js';

export { compareSeverity, emptySeverityCounts, isSeverity, SEVERITIES } from './severity.js';
export type { Severity, SeverityCounts } from './severity.js';

export { isWcagLevel, WCAG_LEVELS } from './wcag.js';
export type { WcagCriterion, WcagLevel } from './wcag.js';

export { runAudit } from './run-audit.js';
export type { RunAuditOptions } from './run-audit.js';

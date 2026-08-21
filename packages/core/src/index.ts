/**
 * Public API of `@ally/core`.
 *
 * Curated on purpose: everything exported here is something another package is
 * meant to depend on. Internals stay unexported so boundaries remain visible.
 *
 * Core depends on nothing. No browser, no engine, no reporter, no I/O — which
 * is what lets every one of those be swapped without touching the model.
 */
export { AUDIT_SCHEMA_VERSION } from './audit.js';
export type {
  AuditCoverage,
  AuditResult,
  AuditRun,
  AuditSummary,
  AuditTarget,
  EngineContribution,
  EngineFailure,
  EngineRun,
} from './audit.js';

export { CATEGORY_LABELS, categoryOf, FINDING_CATEGORIES, isFindingCategory } from './category.js';
export type { FindingCategory } from './category.js';

export { criteriaRelation, DEDUPE_VERSION, dedupeFindings } from './dedupe.js';
export type { AllyFinding, DedupeConfidence, DedupeResult, FindingSource } from './dedupe.js';

export type {
  AuditContext,
  AuditEngine,
  EngineDescriptor,
  EngineMetadata,
  EngineOutput,
  EngineStatus,
} from './engine.js';

export { findingId, truncateHtml } from './finding.js';
export type { Evidence, FindingTarget, NormalizedFinding } from './finding.js';

export { isElementPath, normalizeElementPath } from './path.js';

export { KEYBOARD_ANOMALIES, summarizeKeyboard } from './keyboard.js';
export type {
  FocusableElement,
  KeyboardAnalysis,
  KeyboardAnalyzer,
  KeyboardAnomaly,
  KeyboardAnomalyKind,
  KeyboardFailure,
  KeyboardReport,
  KeyboardSummary,
  TabStop,
  Traversal,
  TraversalBudget,
  TraversalStop,
} from './keyboard.js';

export {
  HALF_PENALTY,
  SCORE_METHODOLOGY,
  SCORE_VERSION,
  SEVERITY_WEIGHTS,
  STANDARD_WEIGHTS,
  scoreAudit,
} from './score.js';
export type { AutomatedScore, ScoreBreakdownEntry } from './score.js';

export {
  compareSeverity,
  countBySeverity,
  emptySeverityCounts,
  isSeverity,
  maxSeverity,
  SEVERITIES,
} from './severity.js';
export type { Severity, SeverityCounts } from './severity.js';

export {
  compareCriteria,
  isAaaOnly,
  isWcagLevel,
  normalizeCriterionId,
  RULE_STANDARDS,
  sortCriteria,
  strictestLevel,
  WCAG_CRITERIA,
  WCAG_LEVELS,
  wcagCriterion,
} from './wcag.js';
export type { RuleStandard, WcagCriterion, WcagCriterionInfo, WcagLevel } from './wcag.js';

export { runAudit } from './run-audit.js';
export type { RunAuditOptions } from './run-audit.js';

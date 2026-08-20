import type { Severity } from './severity.js';
import type { WcagCriterion } from './wcag.js';

/**
 * A single observed occurrence backing a finding.
 *
 * Evidence is what makes a finding actionable and reviewable by a human. Every
 * field is optional because engines differ in what they can report.
 */
export interface Evidence {
  /** CSS selector for the offending element, when the engine reports one. */
  readonly selector?: string;
  /** Outer HTML snippet of the element. Adapters truncate long markup. */
  readonly html?: string;
  /** Engine-provided explanation of why this element failed the rule. */
  readonly message?: string;
}

/**
 * An engine finding translated into Ally's shared vocabulary.
 *
 * Normalized findings are still *per engine*: two engines detecting the same
 * problem produce two findings. Collapsing them is the job of a later
 * deduplication step, which does not exist yet.
 */
export interface NormalizedFinding {
  /** Stable identifier within an audit, formatted as `<engineId>:<ruleId>`. */
  readonly id: string;
  /** Engine that produced this finding. */
  readonly engineId: string;
  /** Rule identifier as used by the originating engine. */
  readonly ruleId: string;
  readonly severity: Severity;
  /** Short human-readable summary of the problem. */
  readonly title: string;
  /** Longer explanation, when the engine provides one. */
  readonly description?: string;
  /** Link to the engine's documentation for this rule. */
  readonly helpUrl?: string;
  /** Success criteria the engine associated with this rule. */
  readonly wcag: readonly WcagCriterion[];
  /** Elements that triggered the finding. */
  readonly evidence: readonly Evidence[];
}

/** Builds the conventional cross-engine finding identifier. */
export function findingId(engineId: string, ruleId: string): string {
  return `${engineId}:${ruleId}`;
}

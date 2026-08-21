import type { FindingCategory } from './category.js';
import type { Severity } from './severity.js';
import type { RuleStandard, WcagCriterion } from './wcag.js';

/**
 * Where in the page a finding was observed.
 *
 * `path` is the field deduplication relies on: a canonical, engine-independent
 * element path of the form `/html[1]/body[1]/main[1]/p[2]`. Every adapter
 * produces it the same way, which is what makes "axe, IBM and Alfa all found
 * this on the same element" a decidable question rather than a guess.
 *
 * Everything else is for humans: the engine's own selector, the markup, and a
 * label such as an accessible name.
 */
export interface FindingTarget {
  /** Canonical element path. Absent when the engine reported no locator. */
  readonly path?: string;
  /** The locator the engine itself reported, in its own syntax. */
  readonly selector?: string;
  /** Outer HTML of the element's opening tag. Adapters truncate long markup. */
  readonly html?: string;
  /** Accessible name or other short label, when the engine supplies one. */
  readonly label?: string;
  /** Lowercase tag name, when known. */
  readonly tagName?: string;
}

/**
 * One observation backing a finding: why the engine considers it a problem.
 *
 * Evidence is quoted from the engine rather than rewritten, so a reader can
 * always trace a finding back to the tool that produced it.
 */
export interface Evidence {
  /** The engine's own explanation. */
  readonly message: string;
  /** Engine-specific reason or result code, when the engine emits one. */
  readonly code?: string;
  /** Engine that produced this observation. */
  readonly engineId: string;
}

/**
 * One engine's finding, translated into Ally's shared vocabulary.
 *
 * Normalized findings are still *per engine and per element*: two engines
 * reporting the same problem on the same element produce two of these.
 * Collapsing them is {@link ../dedupe.js | deduplication}'s job.
 *
 * Splitting per element rather than per rule matters: deduplication compares
 * "this problem, on this element", which is only expressible if a finding
 * refers to a single element.
 */
export interface NormalizedFinding {
  /** Unique within an audit: `<engineId>:<ruleId>:<ordinal>`. */
  readonly id: string;
  readonly engineId: string;
  /** Rule identifier as used by the originating engine. */
  readonly ruleId: string;
  readonly category: FindingCategory;
  readonly standard: RuleStandard;
  readonly severity: Severity;
  /**
   * The engine's own severity or policy word, kept verbatim.
   * Present only when the engine actually reports one.
   */
  readonly rawSeverity?: string;
  /** Short human-readable summary of the problem. */
  readonly title: string;
  /** Longer explanation, when the engine provides one. */
  readonly description?: string;
  /** Link to the engine's documentation for this rule. */
  readonly helpUrl?: string;
  /** Success criteria the engine explicitly associated with this rule. */
  readonly wcag: readonly WcagCriterion[];
  readonly target?: FindingTarget;
  readonly evidence: readonly Evidence[];
}

/** Builds the conventional per-engine finding identifier. */
export function findingId(engineId: string, ruleId: string, ordinal: number): string {
  return `${engineId}:${ruleId}:${ordinal}`;
}

/**
 * Truncates markup kept for display.
 *
 * Evidence markup is stored for a human to read, not to re-parse, so a long
 * snippet is worth less than a small artifact.
 */
export function truncateHtml(html: string, maxLength = 400): string {
  const collapsed = html.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}…`;
}

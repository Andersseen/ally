import type { AuditContext, EngineMetadata } from './engine.js';
import type { NormalizedFinding } from './finding.js';

/**
 * The model for Ally's keyboard/focus analysis.
 *
 * This lives in core because it is domain vocabulary, not an implementation:
 * core defines what a tab stop and a traversal anomaly *are*, while
 * `@ally/analyzer-keyboard` produces them with a real browser. Core still
 * imports no browser and no third-party library.
 */

/** One element in the page's expected or observed keyboard surface. */
export interface FocusableElement {
  /** Canonical element path, shared with findings so the two can be joined. */
  readonly path: string;
  readonly tagName: string;
  /** Accessible name or visible text, trimmed. Empty when the element has none. */
  readonly label: string;
  /** ARIA role, explicit or implicit, when it could be determined. */
  readonly role?: string;
  /** Effective `tabindex`. Absent when the attribute is not set. */
  readonly tabIndex?: number;
  /** Opening tag markup, truncated. */
  readonly html?: string;
}

/** One observed stop in an actual traversal. */
export interface TabStop extends FocusableElement {
  /** 1-based position in the observed sequence. */
  readonly order: number;
  /** True when `tabbable` also predicted this element. */
  readonly expected: boolean;
}

/**
 * Why a traversal stopped.
 *
 * Every traversal ends for a stated reason: Ally never silently truncates.
 */
export type TraversalStop =
  'completed' | 'budget-exhausted' | 'timeout' | 'cycle-detected' | 'focus-lost';

export interface TraversalBudget {
  readonly maxTabPresses: number;
  readonly maxShiftTabPresses: number;
  readonly timeoutMs: number;
}

export interface Traversal {
  readonly stops: readonly TabStop[];
  readonly keyPresses: number;
  readonly stoppedBecause: TraversalStop;
}

/** The kinds of anomaly this version of the analyzer can report. */
export const KEYBOARD_ANOMALIES = [
  'positive-tabindex',
  'unreachable-candidate',
  'unexpected-stop',
  'focus-loss',
  'potential-trap',
] as const;

export type KeyboardAnomalyKind = (typeof KEYBOARD_ANOMALIES)[number];

export interface KeyboardAnomaly {
  readonly kind: KeyboardAnomalyKind;
  /** Elements the anomaly concerns. Empty when it concerns the page overall. */
  readonly elements: readonly FocusableElement[];
  /** What was observed, stated without over-claiming. */
  readonly detail: string;
}

/** A completed keyboard analysis. */
export interface KeyboardAnalysis {
  readonly status: 'ok';
  readonly durationMs: number;
  readonly budget: TraversalBudget;
  /** What `tabbable` predicted would be in the sequential focus order. */
  readonly expected: readonly FocusableElement[];
  readonly forward: Traversal;
  readonly reverse: Traversal;
  readonly anomalies: readonly KeyboardAnomaly[];
}

export interface KeyboardFailure {
  readonly status: 'failed';
  readonly durationMs: number;
  readonly error: { readonly message: string; readonly stack?: string };
}

export type KeyboardReport = KeyboardAnalysis | KeyboardFailure;

/**
 * Contract for Ally's keyboard analyzer.
 *
 * Kept separate from {@link ../engine.js | AuditEngine} on purpose: an engine
 * inspects a static snapshot, whereas an analyzer *drives* the browser. The two
 * deserve different names in the report because they answer different questions
 * and fail in different ways.
 */
export interface KeyboardAnalyzer<TPage = unknown> extends EngineMetadata {
  analyze(context: AuditContext<TPage>): Promise<KeyboardAnalysis>;
  /** Derives findings from an analysis. Must be pure. */
  toFindings(analysis: KeyboardAnalysis): readonly NormalizedFinding[];
}

/** Counts for the report's keyboard summary. */
export interface KeyboardSummary {
  readonly expectedTabbable: number;
  readonly observedStops: number;
  readonly anomalies: number;
  readonly stoppedBecause: TraversalStop;
}

export function summarizeKeyboard(report: KeyboardReport): KeyboardSummary | undefined {
  if (report.status !== 'ok') return undefined;

  return {
    expectedTabbable: report.expected.length,
    observedStops: report.forward.stops.length,
    anomalies: report.anomalies.length,
    stoppedBecause: report.forward.stoppedBecause,
  };
}

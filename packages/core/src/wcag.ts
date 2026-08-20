/**
 * WCAG references attached to findings.
 *
 * Ally records which success criteria an engine *associated* with a finding.
 * It never asserts that passing automated checks establishes conformance.
 */
export const WCAG_LEVELS = ['A', 'AA', 'AAA'] as const;

export type WcagLevel = (typeof WCAG_LEVELS)[number];

export interface WcagCriterion {
  /** Success criterion number, for example `1.4.3`. */
  readonly id: string;
  /** Conformance level, when the engine reports one. Never inferred. */
  readonly level?: WcagLevel;
}

export function isWcagLevel(value: string): value is WcagLevel {
  return (WCAG_LEVELS as readonly string[]).includes(value);
}

/**
 * Ally's severity scale, ordered from most to least urgent.
 *
 * Engines report impact on their own scales; adapters map onto this list so
 * that findings from different engines become comparable. The scale describes
 * *likely user impact*, not WCAG conformance.
 *
 * `info` exists for observations an engine reports without claiming harm. It
 * carries no weight in the Automated Accessibility Score.
 */
export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor', 'info'] as const;

export type Severity = (typeof SEVERITIES)[number];

export type SeverityCounts = Readonly<Record<Severity, number>>;

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  info: 4,
};

/**
 * Comparator sorting the most urgent severity first.
 * Suitable for direct use with `Array.prototype.sort`.
 */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/**
 * The more urgent of two severities.
 *
 * Used when several engines report the same problem with different impact:
 * Ally keeps the most urgent claim and records every engine's own value
 * alongside it, rather than averaging judgements that are not comparable.
 */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
}

export function countBySeverity(items: readonly { readonly severity: Severity }[]): SeverityCounts {
  const counts: Record<Severity, number> = { ...emptySeverityCounts() };
  for (const item of items) {
    counts[item.severity] += 1;
  }
  return counts;
}

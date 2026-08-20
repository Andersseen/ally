/**
 * Ally's severity scale, ordered from most to least urgent.
 *
 * Engines report impact on their own scales; adapters map onto this list so
 * that findings from different engines become comparable. The scale describes
 * *likely user impact*, not WCAG conformance.
 */
export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;

export type Severity = (typeof SEVERITIES)[number];

export type SeverityCounts = Readonly<Record<Severity, number>>;

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
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

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0 };
}

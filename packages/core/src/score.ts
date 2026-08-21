import type { AllyFinding } from './dedupe.js';
import type { Severity } from './severity.js';
import type { RuleStandard } from './wcag.js';

/**
 * Version of the scoring methodology.
 *
 * Bump whenever weights or the formula change, so two scores are only ever
 * compared when they were produced the same way.
 */
export const SCORE_VERSION = 1;

/**
 * Penalty weight per severity.
 *
 * These express *relative* urgency, not a measurement. `info` is weightless
 * because an observation with no claimed harm must not move a score.
 */
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  critical: 10,
  serious: 6,
  moderate: 3,
  minor: 1,
  info: 0,
};

/**
 * Multiplier per rule classification.
 *
 * A rule an engine calls a best practice is worth something, but it is not a
 * WCAG failure and must not be scored like one.
 */
export const STANDARD_WEIGHTS: Readonly<Record<RuleStandard, number>> = {
  wcag: 1,
  'best-practice': 0.4,
  unknown: 0.7,
};

/**
 * Half-life constant of the score curve.
 *
 * `HALF_PENALTY` penalty points cost half of the available score. Chosen so
 * that a page whose worst problem is a single critical finding lands near 80
 * rather than near zero — the score has to separate bad pages from terrible
 * ones, not bottom out on the first finding.
 */
export const HALF_PENALTY = 40;

export interface ScoreBreakdownEntry {
  readonly severity: Severity;
  readonly standard: RuleStandard;
  /** Distinct problem groups at this severity and classification. */
  readonly groups: number;
  /** Unique findings folded into those groups. */
  readonly findings: number;
  readonly penalty: number;
}

/**
 * The Automated Accessibility Score.
 *
 * This is **not** a WCAG conformance score. It summarizes what automated tools
 * found, nothing more: 100 means "no automated engine reported a problem", and
 * a page can score 100 while being unusable.
 */
export interface AutomatedScore {
  /** 0–100, higher is better. */
  readonly value: number;
  readonly version: number;
  /** Total weighted penalty that produced the value. */
  readonly penalty: number;
  readonly breakdown: readonly ScoreBreakdownEntry[];
  /** Unique findings the score was computed from. */
  readonly findingCount: number;
  /** Problem groups the score was computed from. */
  readonly groupCount: number;
}

/**
 * A short, versioned description of how the score was produced.
 *
 * Shipped inside the artifact so a report can always explain its own number,
 * even years later and without this source tree.
 */
export const SCORE_METHODOLOGY = {
  version: SCORE_VERSION,
  name: 'Automated Accessibility Score',
  summary:
    'A weighted penalty over deduplicated findings, mapped onto 0–100. It summarizes automated results only.',
  steps: [
    'Findings are deduplicated across engines first, so a problem several engines report is penalized once.',
    'Unique findings are grouped by rule family and success criterion, so one recurring problem does not scale linearly with the number of affected elements.',
    'Each group costs its most urgent severity weight, multiplied by 1 + ln(number of findings in the group).',
    'Best-practice groups count at 40% and unclassified groups at 70% of a WCAG group.',
    'The score is 100 × 40 / (40 + total penalty), so it falls quickly at first and never reaches zero.',
  ],
  limits: [
    'A score of 100 does not mean the page conforms to WCAG.',
    'Automated engines detect only a subset of accessibility barriers.',
    'Engine failures reduce audit coverage; they never lower the score.',
  ],
} as const;

/**
 * Computes the score from deduplicated findings.
 *
 * Two properties matter more than the exact numbers:
 *
 * - **Adding an engine cannot lower the score on its own.** Only new *unique*
 *   problems cost anything, so a fourth engine that agrees with the other three
 *   changes nothing.
 * - **One problem is charged once.** Sixty low-contrast paragraphs are one
 *   problem repeated, not sixty problems, so a group's cost grows with the
 *   logarithm of its size rather than its size.
 */
export function scoreAudit(findings: readonly AllyFinding[]): AutomatedScore {
  const groups = groupFindings(findings);
  const entries = new Map<string, { entry: ScoreBreakdownEntry; penalty: number }>();

  let penalty = 0;

  for (const group of groups.values()) {
    const weight = SEVERITY_WEIGHTS[group.severity] * STANDARD_WEIGHTS[group.standard];
    // Diminishing returns: the second occurrence of a problem is informative,
    // the sixtieth is not.
    const scale = 1 + Math.log(group.count);
    const cost = round(weight * scale, 3);
    penalty += cost;

    const key = `${group.severity}|${group.standard}`;
    const existing = entries.get(key);
    if (existing === undefined) {
      entries.set(key, {
        entry: {
          severity: group.severity,
          standard: group.standard,
          groups: 1,
          findings: group.count,
          penalty: cost,
        },
        penalty: cost,
      });
    } else {
      entries.set(key, {
        entry: {
          severity: existing.entry.severity,
          standard: existing.entry.standard,
          groups: existing.entry.groups + 1,
          findings: existing.entry.findings + group.count,
          penalty: round(existing.entry.penalty + cost, 3),
        },
        penalty: existing.penalty + cost,
      });
    }
  }

  penalty = round(penalty, 3);

  return {
    value: Math.round((100 * HALF_PENALTY) / (HALF_PENALTY + penalty)),
    version: SCORE_VERSION,
    penalty,
    breakdown: [...entries.values()].map(({ entry }) => entry),
    findingCount: findings.length,
    groupCount: groups.size,
  };
}

interface ScoreGroup {
  severity: Severity;
  readonly standard: RuleStandard;
  count: number;
}

/**
 * Groups findings by "the same kind of problem".
 *
 * A group is a rule family plus the criteria it maps to — the element is
 * deliberately not part of the key, because the same problem on many elements
 * is one thing to fix.
 */
function groupFindings(findings: readonly AllyFinding[]): ReadonlyMap<string, ScoreGroup> {
  const groups = new Map<string, ScoreGroup>();

  for (const finding of findings) {
    const criteria = finding.wcag.map((criterion) => criterion.id).join(',');
    const key = `${finding.category}|${criteria}|${finding.standard}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, { severity: finding.severity, standard: finding.standard, count: 1 });
      continue;
    }

    existing.count += 1;
    // A group costs what its worst member costs.
    if (SEVERITY_WEIGHTS[finding.severity] > SEVERITY_WEIGHTS[existing.severity]) {
      existing.severity = finding.severity;
    }
  }

  return groups;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

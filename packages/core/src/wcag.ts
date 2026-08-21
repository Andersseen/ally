/**
 * WCAG references attached to findings.
 *
 * Ally records which success criteria an engine *associated* with a finding.
 * It never asserts that passing automated checks establishes conformance, and
 * it never derives a criterion from prose: a criterion is recorded only when an
 * engine states it explicitly.
 */
export const WCAG_LEVELS = ['A', 'AA', 'AAA'] as const;

export type WcagLevel = (typeof WCAG_LEVELS)[number];

export interface WcagCriterion {
  /** Success criterion number, for example `1.4.3`. */
  readonly id: string;
  /** Conformance level. Resolved from {@link WCAG_CRITERIA}, never guessed. */
  readonly level?: WcagLevel;
  /** Official criterion title, when the number is one Ally knows. */
  readonly title?: string;
}

/**
 * How a rule relates to WCAG.
 *
 * Engines mix conformance rules with their own recommendations, so Ally keeps
 * the distinction explicit rather than treating every finding as a WCAG issue.
 */
export const RULE_STANDARDS = ['wcag', 'best-practice', 'unknown'] as const;

export type RuleStandard = (typeof RULE_STANDARDS)[number];

export function isWcagLevel(value: string): value is WcagLevel {
  return (WCAG_LEVELS as readonly string[]).includes(value);
}

/** A bare success-criterion number such as `1.4.3` or `2.4.11`. */
const CRITERION_ID = /^([1-4])\.(\d{1,2})\.(\d{1,2})$/;

/**
 * Normalizes an engine's criterion reference to `p.g.c`.
 *
 * Accepts the forms engines actually emit — `1.4.3`, `WCAG 1.4.3`, `sc1.4.3`,
 * `1.4.3 Contrast (Minimum)` — and rejects everything else. Prose is never
 * mined for numbers: an unparseable reference yields `undefined` so that the
 * finding is reported with no criterion rather than with a guessed one.
 */
export function normalizeCriterionId(raw: string): string | undefined {
  const candidate = raw
    .trim()
    .replace(/^(wcag|sc)[\s:-]*/i, '')
    .split(/\s/)[0]
    ?.replace(/[.:]$/, '');

  if (candidate === undefined) return undefined;

  const match = CRITERION_ID.exec(candidate);
  if (match === null) return undefined;

  const [, principle, guideline, criterion] = match;
  // Reject `01.04.03`-style padding rather than silently reinterpreting it.
  if (`${principle}.${guideline}.${criterion}` !== candidate) return undefined;

  return candidate;
}

/**
 * Builds a criterion reference.
 *
 * The level comes from Ally's published-data table unless an engine supplied
 * one, because levels are a fact about WCAG rather than an engine opinion.
 * Returns `undefined` for references Ally cannot parse.
 */
export function wcagCriterion(raw: string, level?: string): WcagCriterion | undefined {
  const id = normalizeCriterionId(raw);
  if (id === undefined) return undefined;

  const known = WCAG_CRITERIA[id];
  const resolved = level !== undefined && isWcagLevel(level) ? level : known?.level;

  return {
    id,
    ...(resolved === undefined ? {} : { level: resolved }),
    ...(known === undefined ? {} : { title: known.title }),
  };
}

/** Sorts criteria by number, so `1.4.3` precedes `1.4.12`. */
export function compareCriteria(a: WcagCriterion, b: WcagCriterion): number {
  const left = a.id.split('.').map(Number);
  const right = b.id.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** De-duplicates and orders a criterion list. */
export function sortCriteria(criteria: readonly WcagCriterion[]): readonly WcagCriterion[] {
  const byId = new Map<string, WcagCriterion>();
  for (const criterion of criteria) {
    const existing = byId.get(criterion.id);
    // Prefer the richer record when the same criterion arrives twice.
    if (existing === undefined || (existing.level === undefined && criterion.level !== undefined)) {
      byId.set(criterion.id, criterion);
    }
  }
  return [...byId.values()].sort(compareCriteria);
}

const LEVEL_RANK: Readonly<Record<WcagLevel, number>> = { A: 0, AA: 1, AAA: 2 };

/**
 * The strictest level a set of criteria can be satisfied at — that is, the
 * *lowest* conformance level present, since A is required before AA.
 */
export function strictestLevel(criteria: readonly WcagCriterion[]): WcagLevel | undefined {
  let best: WcagLevel | undefined;
  for (const criterion of criteria) {
    if (criterion.level === undefined) continue;
    if (best === undefined || LEVEL_RANK[criterion.level] < LEVEL_RANK[best]) {
      best = criterion.level;
    }
  }
  return best;
}

/** True when every criterion in the set is level AAA. */
export function isAaaOnly(criteria: readonly WcagCriterion[]): boolean {
  return criteria.length > 0 && criteria.every((criterion) => criterion.level === 'AAA');
}

export interface WcagCriterionInfo {
  readonly title: string;
  readonly level: WcagLevel;
}

/**
 * The WCAG 2.2 success criteria, as published by the W3C.
 *
 * This is reference data, not a judgement: it exists so that a criterion
 * number reported by any engine resolves to the same title and conformance
 * level everywhere in Ally. 4.1.1 is included because engines still report it,
 * even though WCAG 2.2 removed it.
 */
export const WCAG_CRITERIA: Readonly<Record<string, WcagCriterionInfo>> = {
  '1.1.1': { title: 'Non-text Content', level: 'A' },
  '1.2.1': { title: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  '1.2.2': { title: 'Captions (Prerecorded)', level: 'A' },
  '1.2.3': { title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  '1.2.4': { title: 'Captions (Live)', level: 'AA' },
  '1.2.5': { title: 'Audio Description (Prerecorded)', level: 'AA' },
  '1.2.6': { title: 'Sign Language (Prerecorded)', level: 'AAA' },
  '1.2.7': { title: 'Extended Audio Description (Prerecorded)', level: 'AAA' },
  '1.2.8': { title: 'Media Alternative (Prerecorded)', level: 'AAA' },
  '1.2.9': { title: 'Audio-only (Live)', level: 'AAA' },
  '1.3.1': { title: 'Info and Relationships', level: 'A' },
  '1.3.2': { title: 'Meaningful Sequence', level: 'A' },
  '1.3.3': { title: 'Sensory Characteristics', level: 'A' },
  '1.3.4': { title: 'Orientation', level: 'AA' },
  '1.3.5': { title: 'Identify Input Purpose', level: 'AA' },
  '1.3.6': { title: 'Identify Purpose', level: 'AAA' },
  '1.4.1': { title: 'Use of Color', level: 'A' },
  '1.4.2': { title: 'Audio Control', level: 'A' },
  '1.4.3': { title: 'Contrast (Minimum)', level: 'AA' },
  '1.4.4': { title: 'Resize Text', level: 'AA' },
  '1.4.5': { title: 'Images of Text', level: 'AA' },
  '1.4.6': { title: 'Contrast (Enhanced)', level: 'AAA' },
  '1.4.7': { title: 'Low or No Background Audio', level: 'AAA' },
  '1.4.8': { title: 'Visual Presentation', level: 'AAA' },
  '1.4.9': { title: 'Images of Text (No Exception)', level: 'AAA' },
  '1.4.10': { title: 'Reflow', level: 'AA' },
  '1.4.11': { title: 'Non-text Contrast', level: 'AA' },
  '1.4.12': { title: 'Text Spacing', level: 'AA' },
  '1.4.13': { title: 'Content on Hover or Focus', level: 'AA' },
  '2.1.1': { title: 'Keyboard', level: 'A' },
  '2.1.2': { title: 'No Keyboard Trap', level: 'A' },
  '2.1.3': { title: 'Keyboard (No Exception)', level: 'AAA' },
  '2.1.4': { title: 'Character Key Shortcuts', level: 'A' },
  '2.2.1': { title: 'Timing Adjustable', level: 'A' },
  '2.2.2': { title: 'Pause, Stop, Hide', level: 'A' },
  '2.2.3': { title: 'No Timing', level: 'AAA' },
  '2.2.4': { title: 'Interruptions', level: 'AAA' },
  '2.2.5': { title: 'Re-authenticating', level: 'AAA' },
  '2.2.6': { title: 'Timeouts', level: 'AAA' },
  '2.3.1': { title: 'Three Flashes or Below Threshold', level: 'A' },
  '2.3.2': { title: 'Three Flashes', level: 'AAA' },
  '2.3.3': { title: 'Animation from Interactions', level: 'AAA' },
  '2.4.1': { title: 'Bypass Blocks', level: 'A' },
  '2.4.2': { title: 'Page Titled', level: 'A' },
  '2.4.3': { title: 'Focus Order', level: 'A' },
  '2.4.4': { title: 'Link Purpose (In Context)', level: 'A' },
  '2.4.5': { title: 'Multiple Ways', level: 'AA' },
  '2.4.6': { title: 'Headings and Labels', level: 'AA' },
  '2.4.7': { title: 'Focus Visible', level: 'AA' },
  '2.4.8': { title: 'Location', level: 'AAA' },
  '2.4.9': { title: 'Link Purpose (Link Only)', level: 'AAA' },
  '2.4.10': { title: 'Section Headings', level: 'AAA' },
  '2.4.11': { title: 'Focus Not Obscured (Minimum)', level: 'AA' },
  '2.4.12': { title: 'Focus Not Obscured (Enhanced)', level: 'AAA' },
  '2.4.13': { title: 'Focus Appearance', level: 'AAA' },
  '2.5.1': { title: 'Pointer Gestures', level: 'A' },
  '2.5.2': { title: 'Pointer Cancellation', level: 'A' },
  '2.5.3': { title: 'Label in Name', level: 'A' },
  '2.5.4': { title: 'Motion Actuation', level: 'A' },
  '2.5.5': { title: 'Target Size (Enhanced)', level: 'AAA' },
  '2.5.6': { title: 'Concurrent Input Mechanisms', level: 'AAA' },
  '2.5.7': { title: 'Dragging Movements', level: 'AA' },
  '2.5.8': { title: 'Target Size (Minimum)', level: 'AA' },
  '3.1.1': { title: 'Language of Page', level: 'A' },
  '3.1.2': { title: 'Language of Parts', level: 'AA' },
  '3.1.3': { title: 'Unusual Words', level: 'AAA' },
  '3.1.4': { title: 'Abbreviations', level: 'AAA' },
  '3.1.5': { title: 'Reading Level', level: 'AAA' },
  '3.1.6': { title: 'Pronunciation', level: 'AAA' },
  '3.2.1': { title: 'On Focus', level: 'A' },
  '3.2.2': { title: 'On Input', level: 'A' },
  '3.2.3': { title: 'Consistent Navigation', level: 'AA' },
  '3.2.4': { title: 'Consistent Identification', level: 'AA' },
  '3.2.5': { title: 'Change on Request', level: 'AAA' },
  '3.2.6': { title: 'Consistent Help', level: 'A' },
  '3.3.1': { title: 'Error Identification', level: 'A' },
  '3.3.2': { title: 'Labels or Instructions', level: 'A' },
  '3.3.3': { title: 'Error Suggestion', level: 'AA' },
  '3.3.4': { title: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  '3.3.5': { title: 'Help', level: 'AAA' },
  '3.3.6': { title: 'Error Prevention (All)', level: 'AAA' },
  '3.3.7': { title: 'Redundant Entry', level: 'A' },
  '3.3.8': { title: 'Accessible Authentication (Minimum)', level: 'AA' },
  '3.3.9': { title: 'Accessible Authentication (Enhanced)', level: 'AAA' },
  '4.1.1': { title: 'Parsing (removed in WCAG 2.2)', level: 'A' },
  '4.1.2': { title: 'Name, Role, Value', level: 'A' },
  '4.1.3': { title: 'Status Messages', level: 'AA' },
};

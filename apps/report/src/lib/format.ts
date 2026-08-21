import type { RuleStandard, Severity, WcagCriterion } from '@ally/core';

/**
 * Presentation helpers for the report.
 *
 * Formatting is deliberately locale-independent: the report is a portable
 * build artifact, so it must render identically on every machine that builds it.
 */
export function formatTimestamp(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** `1.4.3 (AA)`, or just `1.4.3` when the level is unknown. */
export function formatCriterion(criterion: WcagCriterion): string {
  return criterion.level === undefined ? criterion.id : `${criterion.id} (${criterion.level})`;
}

export function formatCriteria(criteria: readonly WcagCriterion[]): string {
  return criteria.map(formatCriterion).join(', ');
}

/** How a rule relates to WCAG, in words rather than in a colour. */
export const STANDARD_LABELS: Readonly<Record<RuleStandard, string>> = {
  wcag: 'WCAG',
  'best-practice': 'Best practice',
  unknown: 'Unclassified',
};

/**
 * Severity styling.
 *
 * Every badge carries its severity as text as well, so the colour is
 * reinforcement rather than the only signal.
 */
export const SEVERITY_BADGE: Readonly<Record<Severity, string>> = {
  critical:
    'border-red-400 bg-red-100 text-red-950 dark:border-red-500/60 dark:bg-red-950/50 dark:text-red-100',
  serious:
    'border-orange-400 bg-orange-100 text-orange-950 dark:border-orange-500/60 dark:bg-orange-950/50 dark:text-orange-100',
  moderate:
    'border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-100',
  minor:
    'border-slate-400 bg-slate-100 text-slate-900 dark:border-slate-500/60 dark:bg-slate-800 dark:text-slate-100',
  info: 'border-sky-400 bg-sky-100 text-sky-950 dark:border-sky-500/60 dark:bg-sky-950/50 dark:text-sky-100',
};

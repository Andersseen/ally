import {
  categoryOf,
  findingId,
  normalizeElementPath,
  truncateHtml,
  wcagCriterion,
} from '@ally/core';
import type {
  Evidence,
  FindingTarget,
  NormalizedFinding,
  RuleStandard,
  Severity,
  WcagCriterion,
  WcagLevel,
} from '@ally/core';
import type { AxeResults, NodeResult, Result } from 'axe-core';
import { AXE_ENGINE_ID, AXE_RULE_CATEGORIES } from './metadata.js';

/**
 * axe output, plus the element paths the adapter resolved in the page.
 *
 * axe reports CSS selectors, which cannot be compared with what other engines
 * report. The adapter resolves each selector to Ally's canonical path while the
 * page is still open, and keeps the result beside the untouched axe output so
 * that normalization stays a pure function.
 */
export interface AxeRawOutput {
  readonly results: AxeResults;
  /** CSS selector → canonical element path. */
  readonly paths: Readonly<Record<string, string>>;
}

/** axe success-criterion tags look like `wcag143` (1.4.3) or `wcag1412` (1.4.12). */
const CRITERION_TAG = /^wcag(\d)(\d)(\d{1,2})$/;

/** axe level tags look like `wcag2a`, `wcag21aa` or `wcag22aaa`. */
const LEVEL_TAG = /^wcag\d{1,2}(a{1,3})$/;

const IMPACT_TO_SEVERITY: Readonly<Record<string, Severity>> = {
  critical: 'critical',
  serious: 'serious',
  moderate: 'moderate',
  minor: 'minor',
};

/**
 * Translates axe-core output into Ally findings.
 *
 * Only `violations` become findings. `incomplete` describes checks that need
 * human review rather than failures, and Ally applies the same policy to every
 * engine: a finding means the engine decided, not that it wondered.
 *
 * One finding is produced per *node*, not per rule, because deduplication
 * compares problems element by element.
 *
 * Pure by contract: no browser, no clock, no I/O.
 */
export function normalizeAxeResults(raw: AxeRawOutput): readonly NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];
  let ordinal = 0;

  for (const violation of raw.results.violations) {
    for (const node of violation.nodes) {
      ordinal += 1;
      findings.push(toFinding(violation, node, ordinal, raw.paths));
    }
  }

  return findings;
}

/** Total node-level results axe reported, which is what `rawCount` means. */
export function countAxeViolations(results: AxeResults): number {
  return results.violations.reduce((total, violation) => total + violation.nodes.length, 0);
}

/**
 * Every top-frame selector axe reported.
 *
 * Cross-frame targets are excluded: `document.querySelector` cannot reach into
 * an iframe, so resolving them would produce a path for the wrong element.
 */
export function axeSelectorsOf(results: AxeResults): readonly string[] {
  const selectors = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => toSelector(node.target)),
  );

  return selectors.filter(
    (selector): selector is string => selector !== undefined && !selector.includes(' >>> '),
  );
}

function toFinding(
  violation: Result,
  node: NodeResult,
  ordinal: number,
  paths: Readonly<Record<string, string>>,
): NormalizedFinding {
  const description = violation.description;
  const helpUrl = violation.helpUrl;
  const wcag = toWcagCriteria(violation.tags);
  const target = toTarget(node, paths);
  const message = node.failureSummary;

  return {
    id: findingId(AXE_ENGINE_ID, violation.id, ordinal),
    engineId: AXE_ENGINE_ID,
    ruleId: violation.id,
    category: categoryOf(AXE_RULE_CATEGORIES, violation.id),
    standard: toStandard(violation.tags, wcag),
    severity: toSeverity(violation.impact),
    ...(violation.impact ? { rawSeverity: violation.impact } : {}),
    // `help` is axe's short actionable sentence; `description` is the longer one.
    title: violation.help,
    ...(description ? { description } : {}),
    ...(helpUrl ? { helpUrl } : {}),
    wcag,
    ...(target === undefined ? {} : { target }),
    evidence: message ? [toEvidence(message)] : [],
  };
}

/**
 * axe leaves `impact` unset on a small number of rules. `moderate` is a
 * documented fallback, not an inferred judgement.
 */
function toSeverity(impact: Result['impact']): Severity {
  return (impact && IMPACT_TO_SEVERITY[impact]) ?? 'moderate';
}

/**
 * axe tags every non-WCAG rule `best-practice`, so the classification is read
 * off the engine rather than guessed from the absence of criteria.
 */
function toStandard(tags: readonly string[], wcag: readonly WcagCriterion[]): RuleStandard {
  if (wcag.length > 0) return 'wcag';
  return tags.includes('best-practice') ? 'best-practice' : 'unknown';
}

function toWcagCriteria(tags: readonly string[]): readonly WcagCriterion[] {
  const level = toWcagLevel(tags);
  const criteria: WcagCriterion[] = [];

  for (const tag of tags) {
    const match = CRITERION_TAG.exec(tag);
    if (match === null) continue;

    const [, principle, guideline, criterion] = match;
    if (principle === undefined || guideline === undefined || criterion === undefined) continue;

    const resolved = wcagCriterion(`${principle}.${guideline}.${criterion}`, level);
    if (resolved !== undefined) criteria.push(resolved);
  }

  return criteria;
}

function toWcagLevel(tags: readonly string[]): WcagLevel | undefined {
  for (const tag of tags) {
    switch (LEVEL_TAG.exec(tag)?.[1]) {
      case 'a':
        return 'A';
      case 'aa':
        return 'AA';
      case 'aaa':
        return 'AAA';
      default:
        continue;
    }
  }
  return undefined;
}

function toEvidence(message: string): Evidence {
  return { engineId: AXE_ENGINE_ID, message: message.replace(/\s+/g, ' ').trim() };
}

function toTarget(
  node: NodeResult,
  paths: Readonly<Record<string, string>>,
): FindingTarget | undefined {
  const selector = toSelector(node.target);
  if (selector === undefined) return undefined;

  const resolved = paths[selector];
  const path = resolved === undefined ? undefined : normalizeElementPath(resolved);

  return {
    ...(path === undefined ? {} : { path }),
    selector,
    ...(node.html ? { html: truncateHtml(node.html) } : {}),
  };
}

/**
 * axe targets are nested when an element lives inside an iframe.
 * Frame boundaries are joined with Playwright's `>>>` convention.
 */
function toSelector(target: NodeResult['target']): string | undefined {
  const parts = (target as readonly unknown[])
    .flat(2)
    .filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? parts.join(' >>> ') : undefined;
}

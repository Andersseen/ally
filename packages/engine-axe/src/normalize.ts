import { findingId } from '@ally/core';
import type { Evidence, NormalizedFinding, Severity, WcagCriterion, WcagLevel } from '@ally/core';
import type { AxeResults, NodeResult, Result } from 'axe-core';
import { AXE_ENGINE_ID } from './metadata.js';

/** Evidence markup is stored for humans to read, not to re-parse. */
const MAX_HTML_LENGTH = 400;

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
 * Only `violations` become findings. Passes, incomplete results and
 * inapplicable rules are deliberately dropped here — `incomplete` describes
 * checks needing human review and will get its own model later.
 *
 * Pure by contract: no browser, no clock, no I/O.
 */
export function normalizeAxeResults(raw: AxeResults): readonly NormalizedFinding[] {
  return raw.violations.map(toFinding);
}

function toFinding(violation: Result): NormalizedFinding {
  const description = violation.description;
  const helpUrl = violation.helpUrl;

  return {
    id: findingId(AXE_ENGINE_ID, violation.id),
    engineId: AXE_ENGINE_ID,
    ruleId: violation.id,
    severity: toSeverity(violation.impact),
    // `help` is axe's short actionable sentence; `description` is the longer one.
    title: violation.help,
    ...(description ? { description } : {}),
    ...(helpUrl ? { helpUrl } : {}),
    wcag: toWcagCriteria(violation.tags),
    evidence: violation.nodes.map(toEvidence),
  };
}

/**
 * axe leaves `impact` unset on a small number of rules. `moderate` is a
 * documented fallback, not an inferred judgement.
 */
function toSeverity(impact: Result['impact']): Severity {
  return (impact && IMPACT_TO_SEVERITY[impact]) ?? 'moderate';
}

function toWcagCriteria(tags: readonly string[]): readonly WcagCriterion[] {
  const level = toWcagLevel(tags);
  const criteria: WcagCriterion[] = [];

  for (const tag of tags) {
    const match = CRITERION_TAG.exec(tag);
    if (match === null) continue;

    const [, principle, guideline, criterion] = match;
    if (principle === undefined || guideline === undefined || criterion === undefined) continue;

    const id = `${principle}.${guideline}.${criterion}`;
    criteria.push(level === undefined ? { id } : { id, level });
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

function toEvidence(node: NodeResult): Evidence {
  const selector = toSelector(node.target);
  const message = node.failureSummary;

  return {
    ...(selector !== undefined ? { selector } : {}),
    ...(node.html ? { html: truncate(node.html) } : {}),
    ...(message ? { message } : {}),
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

function truncate(html: string): string {
  return html.length <= MAX_HTML_LENGTH ? html : `${html.slice(0, MAX_HTML_LENGTH)}…`;
}

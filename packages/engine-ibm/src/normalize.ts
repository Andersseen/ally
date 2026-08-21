import {
  categoryOf,
  findingId,
  normalizeElementPath,
  truncateHtml,
  wcagCriterion,
} from '@ally/core';
import type {
  FindingTarget,
  NormalizedFinding,
  RuleStandard,
  Severity,
  WcagCriterion,
} from '@ally/core';
import { IBM_ENGINE_ID, IBM_RULE_CATEGORIES } from './metadata.js';

/**
 * IBM's rule policy — how seriously IBM's own checklist treats a rule.
 *
 * Note that this is a *policy*, not an impact rating: IBM says "this violates
 * our checklist", not "this harms users this much".
 */
export type IbmPolicy = 'VIOLATION' | 'RECOMMENDATION' | 'INFORMATION';

/** IBM's confidence in the result. Only `FAIL` is a decided failure. */
export type IbmConfidence = 'PASS' | 'FAIL' | 'POTENTIAL' | 'MANUAL';

/**
 * One IBM result, with the unserializable `node` handle removed.
 *
 * IBM's own `Issue` type carries a live DOM node, which cannot cross the
 * `page.evaluate` boundary. The adapter strips it inside the page and keeps
 * everything else verbatim.
 */
export interface IbmIssue {
  readonly ruleId: string;
  readonly value: readonly [IbmPolicy, IbmConfidence];
  readonly path: { readonly dom?: string; readonly aria?: string };
  readonly message: string;
  readonly snippet?: string;
  readonly reasonId?: string | number;
  readonly category?: string;
}

/** A rule's success criteria, read off IBM's own guideline definitions. */
export interface IbmRuleMapping {
  readonly criteria: readonly { readonly num: string; readonly level?: string }[];
}

/** What the IBM adapter persists as raw output. */
export interface IbmRawOutput {
  readonly engineVersion?: string;
  readonly guidelineId: string;
  readonly numExecuted: number;
  readonly results: readonly IbmIssue[];
  /** rule id → success criteria, from the engine's own guideline data. */
  readonly ruleMappings: Readonly<Record<string, IbmRuleMapping>>;
  /** Results by `policy+confidence`, so dropped outcomes stay visible. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * IBM policy → Ally severity.
 *
 * IBM grades rules by how its checklist treats them, not by user impact, so
 * Ally maps the policy directly and never synthesizes an impact IBM did not
 * report. That means IBM alone never produces a `critical` finding — when axe
 * calls the same problem critical, deduplication keeps the more urgent claim.
 */
const POLICY_TO_SEVERITY: Readonly<Record<IbmPolicy, Severity>> = {
  VIOLATION: 'serious',
  RECOMMENDATION: 'minor',
  INFORMATION: 'info',
};

/**
 * Translates IBM Equal Access output into Ally findings.
 *
 * Only `FAIL` results become findings. `POTENTIAL` and `MANUAL` are IBM's
 * "needs human review" outcomes, and Ally applies one policy across all
 * engines: a finding means the engine decided. The dropped outcomes stay
 * visible in `counts` and in the raw artifact.
 *
 * Pure by contract: no browser, no clock, no I/O.
 */
export function normalizeIbmResults(raw: IbmRawOutput): readonly NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];
  let ordinal = 0;

  for (const issue of raw.results) {
    if (issue.value[1] !== 'FAIL') continue;

    ordinal += 1;
    findings.push(toFinding(issue, ordinal, raw.ruleMappings[issue.ruleId]));
  }

  return findings;
}

/** How many decided failures IBM reported, which is what `rawCount` means. */
export function countIbmFailures(results: readonly IbmIssue[]): number {
  return results.filter((issue) => issue.value[1] === 'FAIL').length;
}

function toFinding(
  issue: IbmIssue,
  ordinal: number,
  mapping: IbmRuleMapping | undefined,
): NormalizedFinding {
  const policy = issue.value[0];
  const wcag = toWcagCriteria(mapping);
  const target = toTarget(issue);

  return {
    id: findingId(IBM_ENGINE_ID, issue.ruleId, ordinal),
    engineId: IBM_ENGINE_ID,
    ruleId: issue.ruleId,
    category: categoryOf(IBM_RULE_CATEGORIES, issue.ruleId),
    standard: toStandard(policy, wcag),
    severity: POLICY_TO_SEVERITY[policy] ?? 'moderate',
    rawSeverity: policy,
    title: toTitle(issue),
    helpUrl: helpUrlFor(issue.ruleId),
    wcag,
    ...(target === undefined ? {} : { target }),
    evidence: [
      {
        engineId: IBM_ENGINE_ID,
        message: issue.message.replace(/\s+/g, ' ').trim(),
        ...(issue.reasonId === undefined ? {} : { code: String(issue.reasonId) }),
      },
    ],
  };
}

/**
 * IBM's message is a full sentence about the specific element; there is no
 * separate rule title in the engine output, so the message doubles as one.
 * Deduplication keeps whichever source title matches the highest severity, so
 * a shorter title from another engine usually wins the headline.
 */
function toTitle(issue: IbmIssue): string {
  const message = issue.message.replace(/\s+/g, ' ').trim();
  return message === '' ? issue.ruleId : message;
}

/**
 * A `RECOMMENDATION` is IBM's own advice rather than a conformance rule, so it
 * is classified as a best practice even when the rule sits under a criterion.
 */
function toStandard(policy: IbmPolicy, wcag: readonly WcagCriterion[]): RuleStandard {
  if (policy === 'RECOMMENDATION' || policy === 'INFORMATION') return 'best-practice';
  return wcag.length > 0 ? 'wcag' : 'unknown';
}

function toWcagCriteria(mapping: IbmRuleMapping | undefined): readonly WcagCriterion[] {
  if (mapping === undefined) return [];

  const criteria: WcagCriterion[] = [];
  for (const entry of mapping.criteria) {
    const resolved = wcagCriterion(entry.num, entry.level);
    if (resolved !== undefined) criteria.push(resolved);
  }
  return criteria;
}

/**
 * IBM already reports an XPath-shaped DOM path, which is the same shape Ally
 * uses, so nothing has to be resolved in the browser for this engine.
 */
function toTarget(issue: IbmIssue): FindingTarget | undefined {
  const dom = issue.path.dom;
  const path = dom === undefined ? undefined : normalizeElementPath(dom);
  const html = issue.snippet === undefined ? undefined : truncateHtml(issue.snippet);

  if (path === undefined && html === undefined) return undefined;

  return {
    ...(path === undefined ? {} : { path }),
    ...(dom === undefined ? {} : { selector: dom }),
    ...(html === undefined ? {} : { html }),
  };
}

/** IBM publishes one help page per rule, addressed by rule id. */
function helpUrlFor(ruleId: string): string {
  return `https://able.ibm.com/rules/archives/latest/doc/en-US/${ruleId}.html`;
}

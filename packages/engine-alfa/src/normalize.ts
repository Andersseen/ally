import { categoryOf, findingId, isAaaOnly, normalizeElementPath, wcagCriterion } from '@ally/core';
import type {
  Evidence,
  FindingTarget,
  NormalizedFinding,
  RuleStandard,
  Severity,
  WcagCriterion,
} from '@ally/core';
import { ALFA_ENGINE_ID, ALFA_RULE_CATEGORIES } from './metadata.js';

/**
 * The subset of Alfa's serialized outcome Ally reads.
 *
 * Declared structurally rather than imported from `@siteimprove/alfa-act`,
 * because normalization must work on plain JSON — that is what lets it be
 * unit-tested against a recorded fixture with no browser and no Alfa runtime.
 */
export interface AlfaOutcomeJson {
  readonly outcome: string;
  readonly mode?: string;
  readonly rule: {
    readonly uri: string;
    readonly requirements?: readonly AlfaRequirementJson[];
    readonly tags?: readonly { readonly type?: string }[];
  };
  readonly target?: { readonly path?: string; readonly type?: string };
  readonly expectations?: readonly (readonly [string, AlfaExpectationJson])[];
}

export interface AlfaRequirementJson {
  readonly type?: string;
  readonly uri?: string;
  /** Present on `criterion` requirements: the success-criterion number. */
  readonly chapter?: string;
  readonly title?: string;
}

export interface AlfaExpectationJson {
  readonly type?: string;
  readonly error?: { readonly message?: string };
}

/** A short description of the element an outcome concerns. */
export interface AlfaElementJson {
  readonly path: string;
  readonly tagName?: string;
  readonly html?: string;
  readonly label?: string;
}

/** What the Alfa adapter persists as raw output. */
export interface AlfaRawOutput {
  readonly engineVersion?: string;
  /** Outcomes by kind, so what Ally dropped stays visible. */
  readonly counts: Readonly<Record<string, number>>;
  readonly failed: readonly {
    readonly outcome: AlfaOutcomeJson;
    readonly element?: AlfaElementJson;
  }[];
}

/**
 * Alfa reports no impact at all: an ACT rule either passes or fails.
 *
 * So Ally applies one conservative default and lowers it only where the engine
 * itself says the rule is optional — AAA-only criteria, or a rule Alfa marks as
 * a best practice. It never raises the severity, because there is nothing in
 * Alfa's output that would justify doing so. Where axe or IBM call the same
 * problem more urgent, deduplication keeps the stronger claim.
 */
const DEFAULT_SEVERITY: Severity = 'moderate';
const OPTIONAL_SEVERITY: Severity = 'minor';

const RULE_URI_PREFIX = 'https://alfa.siteimprove.com/rules/';

/**
 * Translates Alfa outcomes into Ally findings.
 *
 * Only `failed` outcomes become findings. `cantTell` is Alfa's "needs human
 * review", and Ally treats it the same way it treats axe's `incomplete` and
 * IBM's `POTENTIAL`: recorded in the raw artifact, never reported as a failure.
 *
 * Pure by contract: no browser, no clock, no I/O.
 */
export function normalizeAlfaResults(raw: AlfaRawOutput): readonly NormalizedFinding[] {
  return raw.failed.map((entry, index) => toFinding(entry.outcome, entry.element, index + 1));
}

function toFinding(
  outcome: AlfaOutcomeJson,
  element: AlfaElementJson | undefined,
  ordinal: number,
): NormalizedFinding {
  const ruleId = toRuleId(outcome.rule.uri);
  const requirements = outcome.rule.requirements ?? [];
  const wcag = toWcagCriteria(requirements);
  const standard = toStandard(requirements, wcag);
  const target = toTarget(outcome, element);

  return {
    id: findingId(ALFA_ENGINE_ID, ruleId, ordinal),
    engineId: ALFA_ENGINE_ID,
    ruleId,
    category: categoryOf(ALFA_RULE_CATEGORIES, ruleId),
    standard,
    severity: toSeverity(standard, wcag),
    title: toTitle(outcome, ruleId),
    helpUrl: outcome.rule.uri,
    wcag,
    ...(target === undefined ? {} : { target }),
    evidence: toEvidence(outcome),
  };
}

/** `https://alfa.siteimprove.com/rules/sia-r69` → `sia-r69`. */
function toRuleId(uri: string): string {
  return uri.startsWith(RULE_URI_PREFIX) ? uri.slice(RULE_URI_PREFIX.length) : uri;
}

/**
 * Alfa states the failure in its expectations rather than in a rule title, so
 * the first failed expectation becomes the headline.
 */
function toTitle(outcome: AlfaOutcomeJson, ruleId: string): string {
  const message = failedMessages(outcome)[0];
  return message ?? `Alfa rule ${ruleId} failed`;
}

function failedMessages(outcome: AlfaOutcomeJson): readonly string[] {
  return (outcome.expectations ?? [])
    .filter(([, expectation]) => expectation.type === 'err')
    .map(([, expectation]) => expectation.error?.message?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((message) => message !== '');
}

function toEvidence(outcome: AlfaOutcomeJson): readonly Evidence[] {
  return (outcome.expectations ?? [])
    .filter(([, expectation]) => expectation.type === 'err')
    .flatMap(([key, expectation]) => {
      const message = expectation.error?.message?.replace(/\s+/g, ' ').trim();
      return message === undefined || message === ''
        ? []
        : [{ engineId: ALFA_ENGINE_ID, message, code: key }];
    });
}

function toWcagCriteria(requirements: readonly AlfaRequirementJson[]): readonly WcagCriterion[] {
  const criteria: WcagCriterion[] = [];

  for (const requirement of requirements) {
    // Only `criterion` requirements are success criteria. `technique` points at
    // a WCAG technique and `eaa` at the European Accessibility Act; neither is
    // a criterion, and treating them as one would overstate what Alfa said.
    if (requirement.type !== 'criterion' || requirement.chapter === undefined) continue;

    const resolved = wcagCriterion(requirement.chapter);
    if (resolved !== undefined) criteria.push(resolved);
  }

  return criteria;
}

function toStandard(
  requirements: readonly AlfaRequirementJson[],
  wcag: readonly WcagCriterion[],
): RuleStandard {
  if (wcag.length > 0) return 'wcag';
  return requirements.some((requirement) => requirement.type === 'best practice')
    ? 'best-practice'
    : 'unknown';
}

function toSeverity(standard: RuleStandard, wcag: readonly WcagCriterion[]): Severity {
  if (standard === 'best-practice' || isAaaOnly(wcag)) return OPTIONAL_SEVERITY;
  return DEFAULT_SEVERITY;
}

/**
 * Alfa paths already share Ally's shape, but often address a text node — Alfa
 * evaluates contrast on the text, where axe and IBM report the element that
 * contains it. Normalizing drops that last step so the three line up.
 */
function toTarget(
  outcome: AlfaOutcomeJson,
  element: AlfaElementJson | undefined,
): FindingTarget | undefined {
  const rawPath = element?.path ?? outcome.target?.path;
  if (rawPath === undefined) return undefined;

  const path = normalizeElementPath(rawPath);
  const tagName = element?.tagName;
  const html = element?.html;
  const label = element?.label;

  return {
    ...(path === undefined ? {} : { path }),
    selector: rawPath,
    ...(html === undefined || html === '' ? {} : { html }),
    ...(label === undefined || label === '' ? {} : { label }),
    ...(tagName === undefined || tagName === '' ? {} : { tagName }),
  };
}

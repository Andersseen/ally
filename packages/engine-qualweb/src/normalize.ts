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
import { QUALWEB_ENGINE_ID, QUALWEB_RULE_CATEGORIES } from './metadata.js';

/**
 * QualWeb's evaluation model, declared locally.
 *
 * The types live in `@qualweb/core`, which depends on Puppeteer — a browser
 * Ally does not want installed twice. Since the adapter only ever consumes
 * QualWeb's JSON, describing that JSON here keeps the dependency out without
 * losing type safety.
 */
export type QualwebVerdict = 'passed' | 'warning' | 'failed' | 'inapplicable';

export interface QualwebElement {
  readonly pointer?: string;
  /** Element markup, capped by the adapter — see `MAX_MARKUP_LENGTH`. */
  htmlCode?: string;
  readonly accessibleName?: string;
}

export interface QualwebTestResult {
  readonly verdict: QualwebVerdict;
  readonly description?: string;
  readonly resultCode?: string;
  readonly elements?: readonly QualwebElement[];
}

export interface QualwebSuccessCriterion {
  readonly name: string;
  readonly level?: string;
  readonly url?: string;
}

export interface QualwebAssertion {
  readonly code: string;
  readonly name?: string;
  readonly description?: string;
  readonly mapping?: string;
  readonly metadata: {
    readonly 'success-criteria'?: readonly QualwebSuccessCriterion[];
    readonly url?: string;
    readonly outcome?: string;
  };
  readonly results?: readonly QualwebTestResult[];
}

export interface QualwebModuleReport {
  readonly moduleId: string;
  readonly bestPractice: boolean;
  readonly assertions: Readonly<Record<string, QualwebAssertion>>;
}

/** What the QualWeb adapter persists as raw output. */
export interface QualwebRawOutput {
  readonly engineVersions: Readonly<Record<string, string>>;
  readonly modules: readonly QualwebModuleReport[];
  /** CSS pointer → canonical element path, resolved while the page was open. */
  readonly paths: Readonly<Record<string, string>>;
}

/**
 * QualWeb, like Alfa, reports an ACT verdict rather than an impact rating, so
 * Ally uses the same conservative default and never invents a level QualWeb did
 * not state.
 */
const DEFAULT_SEVERITY: Severity = 'moderate';
const BEST_PRACTICE_SEVERITY: Severity = 'minor';

/**
 * Translates QualWeb module reports into Ally findings.
 *
 * Only `failed` results become findings. `warning` is QualWeb's "needs human
 * review" verdict and is treated exactly like axe's `incomplete`, IBM's
 * `POTENTIAL` and Alfa's `cantTell`: preserved in the raw artifact, never
 * reported as a failure.
 *
 * Pure by contract: no browser, no clock, no I/O.
 */
export function normalizeQualwebResults(raw: QualwebRawOutput): readonly NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];
  let ordinal = 0;

  for (const module of raw.modules) {
    for (const assertion of Object.values(module.assertions)) {
      for (const result of assertion.results ?? []) {
        if (result.verdict !== 'failed') continue;

        // QualWeb groups several elements under one result when they fail the
        // same way; Ally splits them so each element is its own finding.
        const elements = result.elements ?? [];
        const targets = elements.length === 0 ? [undefined] : elements;

        for (const element of targets) {
          ordinal += 1;
          findings.push(
            toFinding(assertion, result, element, module.bestPractice, ordinal, raw.paths),
          );
        }
      }
    }
  }

  return findings;
}

/** Failed element-level results, which is what `rawCount` means. */
export function countQualwebFailures(modules: readonly QualwebModuleReport[]): number {
  let total = 0;

  for (const module of modules) {
    for (const assertion of Object.values(module.assertions)) {
      for (const result of assertion.results ?? []) {
        if (result.verdict !== 'failed') continue;
        total += Math.max(1, result.elements?.length ?? 0);
      }
    }
  }

  return total;
}

/** Every element pointer QualWeb reported, for path resolution in the page. */
export function qualwebPointersOf(modules: readonly QualwebModuleReport[]): readonly string[] {
  const pointers: string[] = [];

  for (const module of modules) {
    for (const assertion of Object.values(module.assertions)) {
      for (const result of assertion.results ?? []) {
        for (const element of result.elements ?? []) {
          if (element.pointer !== undefined && element.pointer !== '')
            pointers.push(element.pointer);
        }
      }
    }
  }

  return pointers;
}

function toFinding(
  assertion: QualwebAssertion,
  result: QualwebTestResult,
  element: QualwebElement | undefined,
  bestPractice: boolean,
  ordinal: number,
  paths: Readonly<Record<string, string>>,
): NormalizedFinding {
  const wcag = toWcagCriteria(assertion.metadata['success-criteria']);
  const standard = toStandard(bestPractice, wcag);
  const target = toTarget(element, paths);
  const description = assertion.description;
  const helpUrl = assertion.metadata.url;
  const message = result.description?.replace(/\s+/g, ' ').trim();

  return {
    id: findingId(QUALWEB_ENGINE_ID, assertion.code, ordinal),
    engineId: QUALWEB_ENGINE_ID,
    ruleId: assertion.code,
    category: categoryOf(QUALWEB_RULE_CATEGORIES, assertion.code),
    standard,
    severity: standard === 'best-practice' ? BEST_PRACTICE_SEVERITY : DEFAULT_SEVERITY,
    rawSeverity: result.verdict,
    title: assertion.name ?? assertion.code,
    ...(description === undefined ? {} : { description }),
    ...(helpUrl === undefined ? {} : { helpUrl }),
    wcag,
    ...(target === undefined ? {} : { target }),
    evidence:
      message === undefined || message === ''
        ? []
        : [
            {
              engineId: QUALWEB_ENGINE_ID,
              message,
              ...(result.resultCode === undefined ? {} : { code: result.resultCode }),
            },
          ],
  };
}

/**
 * QualWeb's best-practices module contains its own recommendations, so its
 * rules are classified as best practices even when they cite a criterion.
 */
function toStandard(bestPractice: boolean, wcag: readonly WcagCriterion[]): RuleStandard {
  if (bestPractice) return 'best-practice';
  return wcag.length > 0 ? 'wcag' : 'unknown';
}

function toWcagCriteria(
  criteria: readonly QualwebSuccessCriterion[] | undefined,
): readonly WcagCriterion[] {
  const resolved: WcagCriterion[] = [];

  for (const criterion of criteria ?? []) {
    const parsed = wcagCriterion(criterion.name, criterion.level);
    if (parsed !== undefined) resolved.push(parsed);
  }

  return resolved;
}

function toTarget(
  element: QualwebElement | undefined,
  paths: Readonly<Record<string, string>>,
): FindingTarget | undefined {
  if (element === undefined) return undefined;

  const pointer = element.pointer;
  const resolved = pointer === undefined ? undefined : paths[pointer];
  const path = resolved === undefined ? undefined : normalizeElementPath(resolved);
  const label = element.accessibleName?.trim();

  if (path === undefined && pointer === undefined && element.htmlCode === undefined) {
    return undefined;
  }

  return {
    ...(path === undefined ? {} : { path }),
    ...(pointer === undefined ? {} : { selector: pointer }),
    ...(element.htmlCode === undefined ? {} : { html: truncateHtml(element.htmlCode) }),
    ...(label === undefined || label === '' ? {} : { label }),
  };
}

import { categoryOf, findingId, sortCriteria, truncateHtml, wcagCriterion } from '@ally/core';
import type {
  Evidence,
  FindingTarget,
  NormalizedFinding,
  RuleStandard,
  Severity,
  WcagCriterion,
} from '@ally/core';
import { HTMLCS_ENGINE_ID, HTMLCS_RULE_CATEGORIES } from './metadata.js';

export interface HtmlCsTarget {
  readonly path?: string;
  readonly selector?: string;
  readonly html?: string;
  readonly label?: string;
  readonly tagName?: string;
}

export interface HtmlCsMessage {
  readonly type: number;
  readonly typeName: 'error' | 'warning' | 'notice' | 'unknown';
  readonly message: string;
  readonly code: string;
  readonly target?: HtmlCsTarget;
}

export interface HtmlCsRawOutput {
  readonly standard: 'WCAG2AA';
  readonly messages: readonly HtmlCsMessage[];
}

const ERROR = 1;
const WARNING = 2;
const NOTICE = 3;

const CRITERION_CODE = /(?:^|\.)((?:[1-4])_(?:\d{1,2})_(?:\d{1,2}))(?:\.|$)/;

export function normalizeHtmlCsResults(raw: HtmlCsRawOutput): readonly NormalizedFinding[] {
  return raw.messages.map((message, index) => toFinding(message, index + 1));
}

export function countHtmlCsMessages(raw: HtmlCsRawOutput): number {
  return raw.messages.length;
}

export function htmlCsTypeName(type: number): HtmlCsMessage['typeName'] {
  switch (type) {
    case ERROR:
      return 'error';
    case WARNING:
      return 'warning';
    case NOTICE:
      return 'notice';
    default:
      return 'unknown';
  }
}

function toFinding(message: HtmlCsMessage, ordinal: number): NormalizedFinding {
  const criterion = criterionFromCode(message.code);
  const wcag = criterion === undefined ? [] : [criterion];
  const ruleId = ruleIdOf(message.code);

  return {
    id: findingId(HTMLCS_ENGINE_ID, ruleId, ordinal),
    engineId: HTMLCS_ENGINE_ID,
    ruleId,
    category: categoryOf(HTMLCS_RULE_CATEGORIES, criterion?.id ?? ruleId),
    standard: toStandard(wcag),
    severity: toSeverity(message.type),
    rawSeverity: message.typeName,
    title: message.message,
    ...(criterion === undefined
      ? {}
      : {
          helpUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${slugOfCriterion(criterion.id)}.html`,
        }),
    wcag,
    ...(message.target === undefined ? {} : { target: toTarget(message.target) }),
    evidence: [toEvidence(message)],
  };
}

export function toSeverity(type: number): Severity {
  switch (type) {
    case ERROR:
      return 'serious';
    case WARNING:
      return 'moderate';
    case NOTICE:
      return 'minor';
    default:
      return 'moderate';
  }
}

function toStandard(wcag: readonly WcagCriterion[]): RuleStandard {
  return wcag.length > 0 ? 'wcag' : 'unknown';
}

export function criterionFromCode(code: string): WcagCriterion | undefined {
  const match = CRITERION_CODE.exec(code);
  const raw = match?.[1]?.replaceAll('_', '.');
  return raw === undefined ? undefined : wcagCriterion(raw);
}

function ruleIdOf(code: string): string {
  const criterion = criterionFromCode(code);
  if (criterion !== undefined) return criterion.id;
  return code === '' ? 'unknown' : code;
}

function toTarget(target: HtmlCsTarget): FindingTarget {
  return {
    ...(target.path === undefined ? {} : { path: target.path }),
    ...(target.selector === undefined ? {} : { selector: target.selector }),
    ...(target.html === undefined ? {} : { html: truncateHtml(target.html) }),
    ...(target.label === undefined || target.label === '' ? {} : { label: target.label }),
    ...(target.tagName === undefined || target.tagName === '' ? {} : { tagName: target.tagName }),
  };
}

function toEvidence(message: HtmlCsMessage): Evidence {
  return {
    engineId: HTMLCS_ENGINE_ID,
    message: message.message.replace(/\s+/g, ' ').trim(),
    ...(message.code === '' ? {} : { code: message.code }),
  };
}

function slugOfCriterion(id: string): string {
  const known = sortCriteria(
    [wcagCriterion(id)].filter((value): value is WcagCriterion => value !== undefined),
  )[0];
  switch (known?.id) {
    case '1.1.1':
      return 'non-text-content';
    case '1.4.3':
      return 'contrast-minimum';
    case '2.4.2':
      return 'page-titled';
    case '3.1.1':
      return 'language-of-page';
    case '3.3.2':
      return 'labels-or-instructions';
    case '4.1.2':
      return 'name-role-value';
    default:
      return id.replaceAll('.', '-');
  }
}

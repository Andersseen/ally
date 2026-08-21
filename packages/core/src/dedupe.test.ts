import { describe, expect, it } from 'vitest';
import { criteriaRelation, dedupeFindings } from './dedupe.js';
import type { FindingCategory } from './category.js';
import type { NormalizedFinding } from './finding.js';
import type { Severity } from './severity.js';
import type { RuleStandard, WcagCriterion } from './wcag.js';

interface FindingOverrides {
  readonly engineId?: string;
  readonly ruleId?: string;
  readonly category?: FindingCategory;
  readonly standard?: RuleStandard;
  readonly severity?: Severity;
  readonly title?: string;
  readonly path?: string | undefined;
  readonly wcag?: readonly WcagCriterion[];
  readonly helpUrl?: string;
}

let ordinal = 0;

function finding(overrides: FindingOverrides = {}): NormalizedFinding {
  ordinal += 1;
  const engineId = overrides.engineId ?? 'axe-core';
  const ruleId = overrides.ruleId ?? 'color-contrast';
  const path = 'path' in overrides ? overrides.path : '/html[1]/body[1]/p[1]';

  return {
    id: `${engineId}:${ruleId}:${ordinal}`,
    engineId,
    ruleId,
    category: overrides.category ?? 'color-contrast',
    standard: overrides.standard ?? 'wcag',
    severity: overrides.severity ?? 'serious',
    title: overrides.title ?? 'Insufficient contrast',
    ...(overrides.helpUrl === undefined ? {} : { helpUrl: overrides.helpUrl }),
    wcag: overrides.wcag ?? [{ id: '1.4.3', level: 'AA' }],
    ...(path === undefined ? {} : { target: { path } }),
    evidence: [{ engineId, message: `${engineId} says so` }],
  };
}

describe('criteriaRelation', () => {
  it('calls identical criterion sets an exact match', () => {
    expect(criteriaRelation([{ id: '1.4.3' }], [{ id: '1.4.3' }])).toBe('exact');
  });

  it('calls overlapping criterion sets a probable match', () => {
    expect(criteriaRelation([{ id: '1.4.3' }], [{ id: '1.4.3' }, { id: '1.4.6' }])).toBe(
      'probable',
    );
  });

  it('refuses to relate disjoint criterion sets', () => {
    expect(criteriaRelation([{ id: '1.4.3' }], [{ id: '1.1.1' }])).toBe('none');
  });

  it('refuses to relate a mapped rule to an unmapped one', () => {
    expect(criteriaRelation([{ id: '1.4.3' }], [])).toBe('none');
    expect(criteriaRelation([], [{ id: '1.4.3' }])).toBe('none');
  });

  it('treats two unmapped rules as a probable match', () => {
    expect(criteriaRelation([], [])).toBe('probable');
  });
});

describe('dedupeFindings', () => {
  it('merges the same problem reported by three engines into one finding', () => {
    const { findings } = dedupeFindings([
      finding({ engineId: 'axe-core' }),
      finding({ engineId: 'ibm-equal-access', ruleId: 'text_contrast_sufficient' }),
      finding({ engineId: 'alfa', ruleId: 'sia-r69' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.engineIds).toEqual(['axe-core', 'ibm-equal-access', 'alfa']);
    expect(findings[0]?.engineAgreement).toBe(3);
    expect(findings[0]?.confidence).toBe('exact');
    expect(findings[0]?.sources).toHaveLength(3);
  });

  it('merges when criteria overlap only partially, but records lower confidence', () => {
    const { findings } = dedupeFindings([
      finding({ engineId: 'axe-core', wcag: [{ id: '1.4.3' }] }),
      finding({ engineId: 'alfa', wcag: [{ id: '1.4.3' }, { id: '1.4.6' }] }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe('probable');
    expect(findings[0]?.wcag.map((criterion) => criterion.id)).toEqual(['1.4.3', '1.4.6']);
  });

  it('never merges findings about different elements', () => {
    const { findings } = dedupeFindings([
      finding({ path: '/html[1]/body[1]/p[1]' }),
      finding({ engineId: 'alfa', path: '/html[1]/body[1]/p[2]' }),
    ]);

    expect(findings).toHaveLength(2);
  });

  it('never merges findings from different rule families', () => {
    const { findings } = dedupeFindings([
      finding({ category: 'color-contrast' }),
      finding({ engineId: 'alfa', category: 'text-alternatives', wcag: [{ id: '1.4.3' }] }),
    ]);

    expect(findings).toHaveLength(2);
  });

  it('never merges findings whose criteria are disjoint', () => {
    const { findings } = dedupeFindings([
      finding({ wcag: [{ id: '1.4.3' }] }),
      finding({ engineId: 'alfa', wcag: [{ id: '1.4.11' }] }),
    ]);

    expect(findings).toHaveLength(2);
  });

  it('never merges a WCAG finding with a best-practice one', () => {
    const { findings } = dedupeFindings([
      finding({ standard: 'wcag', wcag: [{ id: '1.4.3' }] }),
      finding({ engineId: 'alfa', standard: 'best-practice', wcag: [] }),
    ]);

    expect(findings).toHaveLength(2);
  });

  it('leaves findings without an element path alone', () => {
    const { findings } = dedupeFindings([
      finding({ path: undefined }),
      finding({ engineId: 'alfa', path: undefined }),
    ]);

    expect(findings).toHaveLength(2);
    expect(findings.every((item) => item.confidence === 'none')).toBe(true);
  });

  it('merges unclassified rules only on an exact criterion match', () => {
    const exact = dedupeFindings([
      finding({ category: 'other', wcag: [{ id: '3.3.1' }] }),
      finding({ engineId: 'alfa', category: 'other', wcag: [{ id: '3.3.1' }] }),
    ]);
    expect(exact.findings).toHaveLength(1);

    const overlapping = dedupeFindings([
      finding({ category: 'other', wcag: [{ id: '3.3.1' }] }),
      finding({ engineId: 'alfa', category: 'other', wcag: [{ id: '3.3.1' }, { id: '3.3.3' }] }),
    ]);
    expect(overlapping.findings).toHaveLength(2);
  });

  it('merges duplicate rules within a single engine', () => {
    const { findings } = dedupeFindings([
      finding({ engineId: 'alfa', ruleId: 'sia-r66', wcag: [{ id: '1.4.6' }] }),
      finding({ engineId: 'alfa', ruleId: 'sia-r69', wcag: [{ id: '1.4.3' }, { id: '1.4.6' }] }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.engineAgreement).toBe(1);
    expect(findings[0]?.sources.map((source) => source.ruleId)).toEqual(['sia-r66', 'sia-r69']);
  });

  it('keeps the most urgent severity and the title that goes with it', () => {
    const { findings } = dedupeFindings([
      finding({ engineId: 'ibm-equal-access', severity: 'serious', title: 'Low contrast' }),
      finding({ engineId: 'axe-core', severity: 'critical', title: 'Contrast far too low' }),
    ]);

    expect(findings[0]?.severity).toBe('critical');
    expect(findings[0]?.title).toBe('Contrast far too low');
  });

  it('collects every help link and every piece of evidence', () => {
    const { findings } = dedupeFindings([
      finding({ engineId: 'axe-core', helpUrl: 'https://example.com/axe' }),
      finding({ engineId: 'alfa', helpUrl: 'https://example.com/alfa' }),
      finding({ engineId: 'qualweb', helpUrl: 'https://example.com/alfa' }),
    ]);

    expect(findings[0]?.helpUrls).toEqual(['https://example.com/axe', 'https://example.com/alfa']);
    expect(findings[0]?.evidence).toHaveLength(3);
  });

  it('orders findings by severity, then by how many engines agree', () => {
    const { findings } = dedupeFindings([
      finding({ severity: 'moderate', path: '/html[1]/body[1]/p[9]' }),
      finding({ severity: 'critical', path: '/html[1]/body[1]/p[1]' }),
      finding({ severity: 'moderate', path: '/html[1]/body[1]/p[2]' }),
      finding({ engineId: 'alfa', severity: 'moderate', path: '/html[1]/body[1]/p[2]' }),
    ]);

    expect(findings.map((item) => [item.severity, item.engineAgreement])).toEqual([
      ['critical', 1],
      ['moderate', 2],
      ['moderate', 1],
    ]);
  });

  it('numbers findings deterministically and reports the input size', () => {
    const first = dedupeFindings([finding(), finding({ engineId: 'alfa' })]);
    const second = dedupeFindings([finding(), finding({ engineId: 'alfa' })]);

    expect(first.findings[0]?.id).toBe('ally-0001');
    expect(second.findings[0]?.id).toBe('ally-0001');
    expect(first.inputCount).toBe(2);
    expect(first.findings[0]?.fingerprint).toBe('color-contrast@/html[1]/body[1]/p[1]');
  });

  it('handles an empty audit', () => {
    expect(dedupeFindings([])).toEqual({ findings: [], version: 1, inputCount: 0 });
  });
});

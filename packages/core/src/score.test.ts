import { describe, expect, it } from 'vitest';
import type { AllyFinding } from './dedupe.js';
import type { FindingCategory } from './category.js';
import { HALF_PENALTY, SCORE_METHODOLOGY, SCORE_VERSION, scoreAudit } from './score.js';
import type { Severity } from './severity.js';
import type { RuleStandard, WcagCriterion } from './wcag.js';

interface Overrides {
  readonly severity?: Severity;
  readonly standard?: RuleStandard;
  readonly category?: FindingCategory;
  readonly wcag?: readonly WcagCriterion[];
  readonly engineAgreement?: number;
}

let ordinal = 0;

function unique(overrides: Overrides = {}): AllyFinding {
  ordinal += 1;
  return {
    id: `ally-${String(ordinal).padStart(4, '0')}`,
    fingerprint: `fingerprint-${ordinal}`,
    category: overrides.category ?? 'color-contrast',
    standard: overrides.standard ?? 'wcag',
    severity: overrides.severity ?? 'serious',
    title: 'A finding',
    wcag: overrides.wcag ?? [{ id: '1.4.3', level: 'AA' }],
    helpUrls: [],
    evidence: [],
    sources: [],
    engineIds: ['axe-core'],
    engineAgreement: overrides.engineAgreement ?? 1,
    confidence: 'none',
  };
}

describe('scoreAudit', () => {
  it('gives a clean page 100', () => {
    const score = scoreAudit([]);

    expect(score.value).toBe(100);
    expect(score.penalty).toBe(0);
    expect(score.version).toBe(SCORE_VERSION);
  });

  it('penalises a critical finding more than a minor one', () => {
    expect(scoreAudit([unique({ severity: 'critical' })]).value).toBeLessThan(
      scoreAudit([unique({ severity: 'minor' })]).value,
    );
  });

  it('lets an informational finding pass without cost', () => {
    const score = scoreAudit([unique({ severity: 'info' })]);

    expect(score.value).toBe(100);
    expect(score.penalty).toBe(0);
  });

  it('discounts best-practice findings against WCAG ones', () => {
    const wcag = scoreAudit([unique({ standard: 'wcag' })]);
    const practice = scoreAudit([unique({ standard: 'best-practice', wcag: [] })]);

    expect(practice.value).toBeGreaterThan(wcag.value);
    expect(practice.penalty).toBeCloseTo(wcag.penalty * 0.4, 3);
  });

  it('charges a recurring problem once, with diminishing returns', () => {
    const one = scoreAudit([unique()]);
    const ten = scoreAudit(Array.from({ length: 10 }, () => unique()));

    // Ten instances of one problem must not cost ten times one instance.
    expect(ten.penalty).toBeLessThan(one.penalty * 4);
    expect(ten.groupCount).toBe(1);
    expect(ten.findingCount).toBe(10);
  });

  it('charges distinct problems separately', () => {
    const score = scoreAudit([
      unique({ category: 'color-contrast', wcag: [{ id: '1.4.3' }] }),
      unique({ category: 'text-alternatives', wcag: [{ id: '1.1.1' }] }),
    ]);

    expect(score.groupCount).toBe(2);
  });

  it('does not change when another engine agrees about the same problem', () => {
    // Deduplication has already run, so agreement is metadata, not a finding.
    const alone = scoreAudit([unique({ engineAgreement: 1 })]);
    const corroborated = scoreAudit([unique({ engineAgreement: 4 })]);

    expect(corroborated.value).toBe(alone.value);
  });

  it('charges a group at the severity of its worst member', () => {
    const mixed = scoreAudit([unique({ severity: 'minor' }), unique({ severity: 'critical' })]);
    const worst = scoreAudit([unique({ severity: 'critical' }), unique({ severity: 'critical' })]);

    expect(mixed.penalty).toBe(worst.penalty);
  });

  it('reaches the half-way mark at the documented penalty', () => {
    // 100 × 40 / (40 + 40) = 50, by construction.
    expect(Math.round((100 * HALF_PENALTY) / (HALF_PENALTY + HALF_PENALTY))).toBe(50);
  });

  it('stays inside 0–100 for an extremely broken page', () => {
    const score = scoreAudit(
      Array.from({ length: 500 }, (_, index) =>
        unique({ severity: 'critical', category: 'other', wcag: [{ id: `1.1.${index % 9}` }] }),
      ),
    );

    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThan(20);
  });

  it('is reproducible for the same input', () => {
    const findings = [unique({ severity: 'critical' }), unique({ severity: 'moderate' })];

    expect(scoreAudit(findings)).toEqual(scoreAudit(findings));
  });

  it('breaks the penalty down by severity and classification', () => {
    const score = scoreAudit([
      unique({ severity: 'critical', standard: 'wcag' }),
      unique({ severity: 'critical', standard: 'best-practice', wcag: [] }),
    ]);

    expect(score.breakdown).toHaveLength(2);
    expect(score.breakdown.map((entry) => entry.standard).sort()).toEqual([
      'best-practice',
      'wcag',
    ]);
  });

  it('ships a methodology that never claims conformance', () => {
    const text = JSON.stringify(SCORE_METHODOLOGY).toLowerCase();

    expect(SCORE_METHODOLOGY.name).toBe('Automated Accessibility Score');
    expect(text).not.toContain('compliant');
    expect(text).not.toContain('certif');
    expect(SCORE_METHODOLOGY.limits[0]).toContain('does not mean');
  });
});

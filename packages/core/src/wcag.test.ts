import { describe, expect, it } from 'vitest';
import {
  compareCriteria,
  isAaaOnly,
  isWcagLevel,
  normalizeCriterionId,
  sortCriteria,
  strictestLevel,
  WCAG_CRITERIA,
  wcagCriterion,
} from './wcag.js';

describe('normalizeCriterionId', () => {
  it('accepts a bare criterion number', () => {
    expect(normalizeCriterionId('1.4.3')).toBe('1.4.3');
    expect(normalizeCriterionId('2.4.11')).toBe('2.4.11');
  });

  it('strips the prefixes engines put in front of criterion numbers', () => {
    expect(normalizeCriterionId('WCAG 1.4.3')).toBe('1.4.3');
    expect(normalizeCriterionId('wcag:2.1.1')).toBe('2.1.1');
    expect(normalizeCriterionId('SC 4.1.2')).toBe('4.1.2');
  });

  it('keeps only the number when a title follows it', () => {
    expect(normalizeCriterionId('1.4.3 Contrast (Minimum)')).toBe('1.4.3');
  });

  it('rejects references it cannot parse rather than guessing', () => {
    expect(normalizeCriterionId('Contrast (Minimum)')).toBeUndefined();
    expect(normalizeCriterionId('5.1.1')).toBeUndefined();
    expect(normalizeCriterionId('1.4')).toBeUndefined();
    expect(normalizeCriterionId('')).toBeUndefined();
  });

  it('rejects zero-padded numbers instead of reinterpreting them', () => {
    expect(normalizeCriterionId('01.04.03')).toBeUndefined();
  });

  it('does not mine prose for numbers', () => {
    expect(normalizeCriterionId('fails contrast, see 1.4.3 for details')).toBeUndefined();
  });
});

describe('wcagCriterion', () => {
  it('resolves the level and title from published WCAG data', () => {
    expect(wcagCriterion('1.4.3')).toEqual({
      id: '1.4.3',
      level: 'AA',
      title: 'Contrast (Minimum)',
    });
  });

  it('prefers a level the engine reported', () => {
    expect(wcagCriterion('1.4.3', 'AAA')?.level).toBe('AAA');
  });

  it('ignores a level the engine reported in an unknown form', () => {
    expect(wcagCriterion('1.4.3', 'Level AA')?.level).toBe('AA');
  });

  it('returns nothing for an unparseable reference', () => {
    expect(wcagCriterion('not a criterion')).toBeUndefined();
  });

  it('covers every criterion of WCAG 2.2 plus the removed 4.1.1', () => {
    expect(Object.keys(WCAG_CRITERIA)).toHaveLength(87);
    expect(WCAG_CRITERIA['4.1.1']?.title).toContain('removed');
    expect(WCAG_CRITERIA['2.5.8']).toEqual({ title: 'Target Size (Minimum)', level: 'AA' });
  });
});

describe('criterion ordering', () => {
  it('orders by number, not by string', () => {
    expect(compareCriteria({ id: '1.4.3' }, { id: '1.4.12' })).toBeLessThan(0);
    expect(compareCriteria({ id: '2.1.1' }, { id: '1.4.12' })).toBeGreaterThan(0);
  });

  it('de-duplicates and sorts, keeping the richer record', () => {
    const sorted = sortCriteria([
      { id: '1.4.12' },
      { id: '1.4.3' },
      { id: '1.4.3', level: 'AA' },
      { id: '1.4.3' },
    ]);

    expect(sorted).toEqual([{ id: '1.4.3', level: 'AA' }, { id: '1.4.12' }]);
  });
});

describe('level helpers', () => {
  it('narrows level strings', () => {
    expect(isWcagLevel('AA')).toBe(true);
    expect(isWcagLevel('AAAA')).toBe(false);
  });

  it('reports the strictest level a criterion set touches', () => {
    expect(
      strictestLevel([
        { id: '1.4.6', level: 'AAA' },
        { id: '1.4.3', level: 'AA' },
      ]),
    ).toBe('AA');
    expect(strictestLevel([{ id: '1.1.1', level: 'A' }])).toBe('A');
    expect(strictestLevel([{ id: '1.1.1' }])).toBeUndefined();
    expect(strictestLevel([])).toBeUndefined();
  });

  it('recognises criteria that are AAA only', () => {
    expect(isAaaOnly([{ id: '1.4.6', level: 'AAA' }])).toBe(true);
    expect(
      isAaaOnly([
        { id: '1.4.6', level: 'AAA' },
        { id: '1.4.3', level: 'AA' },
      ]),
    ).toBe(false);
    expect(isAaaOnly([])).toBe(false);
  });
});

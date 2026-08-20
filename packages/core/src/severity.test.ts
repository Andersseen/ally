import { describe, expect, it } from 'vitest';
import { compareSeverity, emptySeverityCounts, isSeverity, SEVERITIES } from './severity.js';

describe('severity', () => {
  it('sorts the most urgent severity first', () => {
    const shuffled = ['minor', 'critical', 'moderate', 'serious'] as const;
    expect([...shuffled].sort(compareSeverity)).toEqual([
      'critical',
      'serious',
      'moderate',
      'minor',
    ]);
  });

  it('narrows arbitrary strings to the known scale', () => {
    expect(isSeverity('critical')).toBe(true);
    expect(isSeverity('cosmetic')).toBe(false);
  });

  it('starts every severity bucket at zero', () => {
    const counts = emptySeverityCounts();
    expect(Object.keys(counts).sort()).toEqual([...SEVERITIES].sort());
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

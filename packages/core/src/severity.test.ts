import { describe, expect, it } from 'vitest';
import {
  compareSeverity,
  countBySeverity,
  emptySeverityCounts,
  isSeverity,
  maxSeverity,
  SEVERITIES,
} from './severity.js';

describe('severity', () => {
  it('sorts the most urgent severity first', () => {
    const shuffled = ['minor', 'critical', 'info', 'moderate', 'serious'] as const;
    expect([...shuffled].sort(compareSeverity)).toEqual([
      'critical',
      'serious',
      'moderate',
      'minor',
      'info',
    ]);
  });

  it('narrows arbitrary strings to the known scale', () => {
    expect(isSeverity('critical')).toBe(true);
    expect(isSeverity('info')).toBe(true);
    expect(isSeverity('cosmetic')).toBe(false);
  });

  it('starts every severity bucket at zero', () => {
    const counts = emptySeverityCounts();
    expect(Object.keys(counts).sort()).toEqual([...SEVERITIES].sort());
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });

  it('keeps the more urgent of two severities', () => {
    expect(maxSeverity('moderate', 'critical')).toBe('critical');
    expect(maxSeverity('critical', 'moderate')).toBe('critical');
    expect(maxSeverity('minor', 'info')).toBe('minor');
    expect(maxSeverity('serious', 'serious')).toBe('serious');
  });

  it('counts a collection by severity', () => {
    const counts = countBySeverity([
      { severity: 'critical' },
      { severity: 'minor' },
      { severity: 'minor' },
    ]);

    expect(counts).toEqual({ critical: 1, serious: 0, moderate: 0, minor: 2, info: 0 });
  });
});

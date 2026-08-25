import { describe, expect, it } from 'vitest';
import {
  ALLY_WCAG_22_AA_COVERAGE,
  EXPECTED_WCAG_22_AA_CRITERIA,
  WCAG_22_AA_CRITERIA,
  WCAG_22_DATASET_MANIFEST,
  validateWcagDataset,
} from './index.js';

describe('@ally/wcag dataset', () => {
  it('contains the complete WCAG 2.2 A/AA matrix without AAA or removed 4.1.1', () => {
    expect(WCAG_22_AA_CRITERIA).toHaveLength(55);
    expect(WCAG_22_AA_CRITERIA.every((criterion) => String(criterion.level) !== 'AAA')).toBe(true);
    expect(WCAG_22_AA_CRITERIA.some((criterion) => criterion.id === '4.1.1')).toBe(false);
    expect(new Set(WCAG_22_AA_CRITERIA.map((criterion) => criterion.id)).size).toBe(55);
  });

  it('has valid manifest and coverage references', () => {
    expect(WCAG_22_DATASET_MANIFEST.standard).toBe('WCAG');
    expect(WCAG_22_DATASET_MANIFEST.version).toBe('2.2');
    expect(WCAG_22_DATASET_MANIFEST.datasetVersion).toContain('sha256');
    expect(validateWcagDataset()).toEqual([]);

    const expected = new Set(EXPECTED_WCAG_22_AA_CRITERIA);
    expect(ALLY_WCAG_22_AA_COVERAGE).toHaveLength(expected.size);
    expect(ALLY_WCAG_22_AA_COVERAGE.every((coverage) => expected.has(coverage.criterion))).toBe(
      true,
    );
  });
});

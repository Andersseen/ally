import { describe, expect, test } from 'vitest';
import type { AllyFinding } from '@ally/core';
import { familyOf, remediationFor, remediateFindings } from './index.js';

function finding(overrides: Partial<AllyFinding>): AllyFinding {
  return {
    id: 'ally-0001',
    fingerprint: 'x',
    category: 'other',
    standard: 'unknown',
    severity: 'moderate',
    title: 'Finding',
    wcag: [],
    helpUrls: [],
    evidence: [],
    sources: [
      {
        findingId: 'engine:rule:1',
        engineId: 'engine',
        ruleId: 'rule',
        severity: 'moderate',
        title: 'Finding',
        wcag: [],
      },
    ],
    engineIds: ['engine'],
    engineAgreement: 1,
    confidence: 'none',
    ...overrides,
  };
}

describe('remediationFor', () => {
  test('returns deterministic fixes for common rule families', () => {
    const result = remediationFor(
      finding({
        category: 'text-alternatives',
        sources: [
          {
            findingId: 'axe-core:image-alt:1',
            engineId: 'axe-core',
            ruleId: 'image-alt',
            severity: 'serious',
            title: 'Image needs alt',
            wcag: [{ id: '1.1.1', level: 'A' }],
          },
        ],
      }),
    );

    expect(result.confidence).toBe('high');
    expect(result.goodExample).toContain('alt=');
  });

  test('uses manual-review guidance for potential keyboard traps', () => {
    const result = remediationFor(
      finding({
        category: 'keyboard-and-focus',
        sources: [
          {
            findingId: 'keyboard:potential-trap:1',
            engineId: 'keyboard',
            ruleId: 'potential-trap',
            severity: 'serious',
            title: 'Potential keyboard trap',
            wcag: [],
          },
        ],
      }),
    );

    expect(familyOf(finding({ sources: resultFixtureSource('potential-trap') }))).toBe(
      'keyboard-cycle',
    );
    expect(result.confidence).toBe('manual-review');
    expect(result.steps.join(' ')).toMatch(/modal|Escape/i);
  });

  test('falls back without pretending there is a certain fix', () => {
    const result = remediationFor(finding({}));
    expect(result.confidence).toBe('manual-review');
  });

  test('returns a record keyed by finding id', () => {
    expect(remediateFindings([finding({ id: 'ally-0020' })])).toHaveProperty('ally-0020');
  });
});

function resultFixtureSource(ruleId: string): AllyFinding['sources'] {
  return [
    {
      findingId: `keyboard:${ruleId}:1`,
      engineId: 'keyboard',
      ruleId,
      severity: 'serious',
      title: ruleId,
      wcag: [],
    },
  ];
}

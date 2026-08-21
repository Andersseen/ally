import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AxeResults, Result } from 'axe-core';
import { axeSelectorsOf, countAxeViolations, normalizeAxeResults } from './normalize.js';
import type { AxeRawOutput } from './normalize.js';

/**
 * Fixtures are real axe output, captured by `scripts/capture-fixtures.ts`.
 * Normalization is a pure function, so these tests never launch a browser.
 */
function fixture(name: string): AxeRawOutput {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as AxeRawOutput;
}

function axeResults(violations: readonly Partial<Result>[]): AxeResults {
  return {
    violations: violations.map((violation) => ({
      id: 'image-alt',
      impact: 'critical',
      tags: ['wcag2a', 'wcag111'],
      description: 'Ensures <img> elements have alternate text',
      help: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
      nodes: [{ target: ['#logo'], html: '<img src="logo.png">' }],
      ...violation,
    })),
    passes: [],
    incomplete: [],
    inapplicable: [],
  } as unknown as AxeResults;
}

function raw(
  violations: readonly Partial<Result>[],
  paths: Record<string, string> = { '#logo': '/html[1]/body[1]/img[1]' },
): AxeRawOutput {
  return { results: axeResults(violations), paths };
}

describe('normalizeAxeResults', () => {
  it('maps a violation onto the Ally finding shape', () => {
    const [finding] = normalizeAxeResults(raw([{}]));

    expect(finding).toMatchObject({
      id: 'axe-core:image-alt:1',
      engineId: 'axe-core',
      ruleId: 'image-alt',
      category: 'text-alternatives',
      standard: 'wcag',
      severity: 'critical',
      rawSeverity: 'critical',
      title: 'Images must have alternate text',
      description: 'Ensures <img> elements have alternate text',
    });
  });

  it('produces one finding per offending element, not per rule', () => {
    const findings = normalizeAxeResults(
      raw([
        {
          nodes: [
            { target: ['#logo'], html: '<img src="logo.png">' },
            { target: ['#hero'], html: '<img src="hero.png">' },
          ] as unknown as Result['nodes'],
        },
      ]),
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.target?.selector)).toEqual(['#logo', '#hero']);
    expect(findings.map((finding) => finding.id)).toEqual([
      'axe-core:image-alt:1',
      'axe-core:image-alt:2',
    ]);
  });

  it('attaches the canonical element path the adapter resolved', () => {
    const [finding] = normalizeAxeResults(raw([{}]));

    expect(finding?.target).toEqual({
      path: '/html[1]/body[1]/img[1]',
      selector: '#logo',
      html: '<img src="logo.png">',
    });
  });

  it('reports no path when the selector could not be resolved', () => {
    const [finding] = normalizeAxeResults(raw([{}], {}));

    expect(finding?.target?.path).toBeUndefined();
    expect(finding?.target?.selector).toBe('#logo');
  });

  it('reads success criteria and their level from axe tags', () => {
    const [finding] = normalizeAxeResults(
      raw([{ tags: ['cat.color', 'wcag2aa', 'wcag143', 'wcag1412'] }]),
    );

    expect(finding?.wcag).toEqual([
      { id: '1.4.3', level: 'AA', title: 'Contrast (Minimum)' },
      { id: '1.4.12', level: 'AA', title: 'Text Spacing' },
    ]);
  });

  it('classifies a rule axe tags as a best practice', () => {
    const [finding] = normalizeAxeResults(
      raw([{ id: 'region', tags: ['cat.keyboard', 'best-practice'] }]),
    );

    expect(finding?.standard).toBe('best-practice');
    expect(finding?.wcag).toEqual([]);
  });

  it('classifies a rule with neither criteria nor a best-practice tag as unknown', () => {
    const [finding] = normalizeAxeResults(raw([{ tags: ['cat.semantics'] }]));

    expect(finding?.standard).toBe('unknown');
  });

  it('falls back to moderate when axe reports no impact', () => {
    const [finding] = normalizeAxeResults(raw([{ impact: null }]));

    expect(finding?.severity).toBe('moderate');
    expect(finding).not.toHaveProperty('rawSeverity');
  });

  it('maps every axe impact onto the Ally scale', () => {
    const impacts = ['critical', 'serious', 'moderate', 'minor'] as const;

    for (const impact of impacts) {
      const [finding] = normalizeAxeResults(raw([{ impact }]));
      expect(finding?.severity).toBe(impact);
    }
  });

  it('classifies rules through the explicit category table', () => {
    expect(normalizeAxeResults(raw([{ id: 'color-contrast' }]))[0]?.category).toBe(
      'color-contrast',
    );
    expect(normalizeAxeResults(raw([{ id: 'label' }]))[0]?.category).toBe('forms-and-labels');
    expect(normalizeAxeResults(raw([{ id: 'a-rule-ally-has-not-classified' }]))[0]?.category).toBe(
      'other',
    );
  });

  it('quotes the engine failure summary as evidence', () => {
    const [finding] = normalizeAxeResults(
      raw([
        {
          nodes: [
            {
              target: ['#logo'],
              html: '<img src="logo.png">',
              failureSummary: 'Fix any of the following:\n  Element has no alt attribute',
            },
          ] as unknown as Result['nodes'],
        },
      ]),
    );

    expect(finding?.evidence).toEqual([
      {
        engineId: 'axe-core',
        message: 'Fix any of the following: Element has no alt attribute',
      },
    ]);
  });

  it('truncates very long evidence markup', () => {
    const [finding] = normalizeAxeResults(
      raw([{ nodes: [{ target: ['#x'], html: 'a'.repeat(1000) }] as unknown as Result['nodes'] }]),
    );

    expect(finding?.target?.html).toHaveLength(401);
    expect(finding?.target?.html?.endsWith('…')).toBe(true);
  });

  it('joins cross-frame targets with the Playwright frame convention', () => {
    const [finding] = normalizeAxeResults(
      raw([
        {
          nodes: [{ target: [['#frame', '.banner']] }] as unknown as Result['nodes'],
        },
      ]),
    );

    expect(finding?.target?.selector).toBe('#frame >>> .banner');
  });

  it('returns nothing when the page has no violations', () => {
    expect(normalizeAxeResults(raw([]))).toEqual([]);
  });
});

describe('countAxeViolations', () => {
  it('counts offending elements, which is what axe itself reports', () => {
    const results = axeResults([
      { nodes: [{ target: ['#a'] }, { target: ['#b'] }] as unknown as Result['nodes'] },
      { nodes: [{ target: ['#c'] }] as unknown as Result['nodes'] },
    ]);

    expect(countAxeViolations(results)).toBe(3);
  });
});

describe('axeSelectorsOf', () => {
  it('collects top-frame selectors only', () => {
    const results = axeResults([
      {
        nodes: [
          { target: ['#a'] },
          { target: [['#frame', '.inner']] },
        ] as unknown as Result['nodes'],
      },
    ]);

    // A cross-frame selector cannot be resolved with `document.querySelector`,
    // so asking for its path would produce a path for the wrong element.
    expect(axeSelectorsOf(results)).toEqual(['#a']);
  });
});

describe('normalizeAxeResults, on captured engine output', () => {
  it('finds the contrast failures on the contrast fixture', () => {
    const findings = normalizeAxeResults(fixture('contrast'));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.category === 'color-contrast')).toBe(true);
    expect(findings.every((finding) => finding.severity === 'serious')).toBe(true);
  });

  it('resolves every top-frame selector to a canonical element path', () => {
    const findings = normalizeAxeResults(fixture('missing-label'));

    expect(findings.length).toBeGreaterThan(0);
    // Without a path there is nothing for deduplication to compare.
    for (const finding of findings) {
      expect(finding.target?.path).toMatch(/^\/html\[1\]/);
    }
  });

  it('separates WCAG rules from axe’s own best practices', () => {
    const findings = normalizeAxeResults(fixture('missing-label'));
    const standards = new Set(findings.map((finding) => finding.standard));

    expect(standards.has('wcag')).toBe(true);
    for (const finding of findings) {
      if (finding.standard === 'wcag') expect(finding.wcag.length).toBeGreaterThan(0);
      else expect(finding.wcag).toEqual([]);
    }
  });
});

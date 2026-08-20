import { describe, expect, it } from 'vitest';
import type { AxeResults, Result } from 'axe-core';
import { normalizeAxeResults } from './normalize.js';

function axeResults(violations: readonly Partial<Result>[]): AxeResults {
  return {
    violations: violations.map((violation) => ({
      id: 'image-alt',
      impact: 'critical',
      tags: ['wcag2a', 'wcag111'],
      description: 'Ensures <img> elements have alternate text',
      help: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
      nodes: [],
      ...violation,
    })),
    passes: [],
    incomplete: [],
    inapplicable: [],
  } as unknown as AxeResults;
}

describe('normalizeAxeResults', () => {
  it('maps a violation onto the Ally finding shape', () => {
    const [finding] = normalizeAxeResults(axeResults([{}]));

    expect(finding).toMatchObject({
      id: 'axe-core:image-alt',
      engineId: 'axe-core',
      ruleId: 'image-alt',
      severity: 'critical',
      title: 'Images must have alternate text',
      description: 'Ensures <img> elements have alternate text',
    });
  });

  it('reads success criteria and their level from axe tags', () => {
    const [finding] = normalizeAxeResults(
      axeResults([{ tags: ['cat.color', 'wcag2aa', 'wcag143', 'wcag1412'] }]),
    );

    expect(finding?.wcag).toEqual([
      { id: '1.4.3', level: 'AA' },
      { id: '1.4.12', level: 'AA' },
    ]);
  });

  it('omits the level when axe reports no level tag', () => {
    const [finding] = normalizeAxeResults(axeResults([{ tags: ['wcag111'] }]));

    expect(finding?.wcag).toEqual([{ id: '1.1.1' }]);
    expect(finding?.wcag[0]).not.toHaveProperty('level');
  });

  it('ignores best-practice rules that carry no WCAG tags', () => {
    const [finding] = normalizeAxeResults(
      axeResults([{ tags: ['cat.semantics', 'best-practice'] }]),
    );

    expect(finding?.wcag).toEqual([]);
  });

  it('falls back to moderate when axe reports no impact', () => {
    const [finding] = normalizeAxeResults(axeResults([{ impact: null }]));

    expect(finding?.severity).toBe('moderate');
  });

  it('collects one piece of evidence per offending node', () => {
    const [finding] = normalizeAxeResults(
      axeResults([
        {
          nodes: [
            {
              target: ['#logo'],
              html: '<img src="logo.png">',
              failureSummary: 'Fix any of the following: Element has no alt attribute',
            },
            { target: [['#frame', '.banner']], html: '<img src="ad.png">' },
          ] as unknown as Result['nodes'],
        },
      ]),
    );

    expect(finding?.evidence).toEqual([
      {
        selector: '#logo',
        html: '<img src="logo.png">',
        message: 'Fix any of the following: Element has no alt attribute',
      },
      { selector: '#frame >>> .banner', html: '<img src="ad.png">' },
    ]);
  });

  it('truncates very long evidence markup', () => {
    const [finding] = normalizeAxeResults(
      axeResults([
        { nodes: [{ target: ['#x'], html: 'a'.repeat(1000) }] as unknown as Result['nodes'] },
      ]),
    );

    expect(finding?.evidence[0]?.html).toHaveLength(401);
    expect(finding?.evidence[0]?.html?.endsWith('…')).toBe(true);
  });

  it('returns nothing when the page has no violations', () => {
    expect(normalizeAxeResults(axeResults([]))).toEqual([]);
  });
});

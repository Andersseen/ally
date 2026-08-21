import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeAlfaResults } from './normalize.js';
import type { AlfaElementJson, AlfaOutcomeJson, AlfaRawOutput } from './normalize.js';

/**
 * Fixtures are real Alfa output, captured by `scripts/capture-fixtures.ts`.
 * Normalization is a pure function, so these tests never launch a browser.
 */
function fixture(name: string): AlfaRawOutput {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as AlfaRawOutput;
}

function outcome(overrides: Partial<AlfaOutcomeJson> = {}): AlfaOutcomeJson {
  return {
    outcome: 'failed',
    mode: 'automatic',
    rule: {
      uri: 'https://alfa.siteimprove.com/rules/sia-r69',
      requirements: [
        {
          type: 'criterion',
          uri: 'https://www.w3.org/TR/WCAG2/#contrast-minimum',
          chapter: '1.4.3',
          title: 'Contrast (Minimum)',
        },
      ],
      tags: [{ type: 'scope' }],
    },
    target: { type: 'element', path: '/html[1]/body[1]/main[1]/p[1]/text()[1]' },
    expectations: [
      ['1', { type: 'err', error: { message: 'The text has insufficient contrast' } }],
    ],
    ...overrides,
  };
}

function raw(
  failed: readonly { outcome: AlfaOutcomeJson; element?: AlfaElementJson }[],
): AlfaRawOutput {
  return { engineVersion: '0.119.0', counts: { failed: failed.length }, failed };
}

describe('normalizeAlfaResults, on captured engine output', () => {
  it('finds contrast failures on the contrast fixture', () => {
    const findings = normalizeAlfaResults(fixture('contrast'));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.category === 'color-contrast')).toBe(true);
  });

  it('resolves every finding to a canonical element path', () => {
    const findings = normalizeAlfaResults(fixture('missing-label'));

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      // `/` is the document itself, which some page-scope rules target.
      expect(finding.target?.path).toMatch(/^\/(html\[1\])?/);
    }
  });

  it('never leaves a text node in a path, so element findings line up', () => {
    const findings = normalizeAlfaResults(fixture('contrast'));

    for (const finding of findings) {
      expect(finding.target?.path).not.toContain('text()');
    }
  });

  it('reads success criteria from Alfa’s requirements', () => {
    const findings = normalizeAlfaResults(fixture('contrast'));
    const criteria = findings.flatMap((finding) => finding.wcag.map((item) => item.id));

    expect(criteria).toContain('1.4.3');
    for (const criterion of findings.flatMap((finding) => finding.wcag)) {
      expect(criterion.level).toBeDefined();
    }
  });
});

describe('normalizeAlfaResults', () => {
  it('maps an outcome onto the Ally finding shape', () => {
    const [finding] = normalizeAlfaResults(raw([{ outcome: outcome() }]));

    expect(finding).toMatchObject({
      id: 'alfa:sia-r69:1',
      engineId: 'alfa',
      ruleId: 'sia-r69',
      category: 'color-contrast',
      standard: 'wcag',
      title: 'The text has insufficient contrast',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r69',
    });
  });

  it('drops the trailing text node from Alfa’s path', () => {
    const [finding] = normalizeAlfaResults(raw([{ outcome: outcome() }]));

    // Alfa evaluates contrast on the text; axe and IBM report the paragraph.
    expect(finding?.target?.path).toBe('/html[1]/body[1]/main[1]/p[1]');
    expect(finding?.target?.selector).toBe('/html[1]/body[1]/main[1]/p[1]/text()[1]');
  });

  it('applies one conservative severity, because Alfa reports no impact', () => {
    const [finding] = normalizeAlfaResults(raw([{ outcome: outcome() }]));

    expect(finding?.severity).toBe('moderate');
    expect(finding).not.toHaveProperty('rawSeverity');
  });

  it('lowers the severity for a rule that is only AAA', () => {
    const aaa = outcome({
      rule: {
        uri: 'https://alfa.siteimprove.com/rules/sia-r66',
        requirements: [{ type: 'criterion', chapter: '1.4.6' }],
      },
    });

    expect(normalizeAlfaResults(raw([{ outcome: aaa }]))[0]?.severity).toBe('minor');
  });

  it('records every criterion when a rule cites several', () => {
    const multi = outcome({
      rule: {
        uri: 'https://alfa.siteimprove.com/rules/sia-r69',
        requirements: [
          { type: 'criterion', chapter: '1.4.3' },
          { type: 'criterion', chapter: '1.4.6' },
        ],
      },
    });

    expect(normalizeAlfaResults(raw([{ outcome: multi }]))[0]?.wcag.map((item) => item.id)).toEqual(
      ['1.4.3', '1.4.6'],
    );
  });

  it('does not mistake a technique or an EAA reference for a success criterion', () => {
    const technique = outcome({
      rule: {
        uri: 'https://alfa.siteimprove.com/rules/sia-r87',
        requirements: [
          { type: 'technique', uri: 'https://www.w3.org/WAI/WCAG22/Techniques/general/G1' },
          { type: 'eaa', uri: '' },
        ],
      },
    });

    const [finding] = normalizeAlfaResults(raw([{ outcome: technique }]));
    expect(finding?.wcag).toEqual([]);
    expect(finding?.standard).toBe('unknown');
  });

  it('classifies a rule Alfa marks as a best practice', () => {
    const practice = outcome({
      rule: {
        uri: 'https://alfa.siteimprove.com/rules/sia-r87',
        requirements: [{ type: 'best practice', uri: 'first-focusable-is-skip-link' }],
      },
    });

    const [finding] = normalizeAlfaResults(raw([{ outcome: practice }]));
    expect(finding?.standard).toBe('best-practice');
    expect(finding?.severity).toBe('minor');
  });

  it('uses the element description the adapter captured', () => {
    const [finding] = normalizeAlfaResults(
      raw([
        {
          outcome: outcome(),
          element: {
            path: '/html[1]/body[1]/main[1]/p[1]',
            tagName: 'p',
            html: '<p class="faint">',
          },
        },
      ]),
    );

    expect(finding?.target).toMatchObject({
      path: '/html[1]/body[1]/main[1]/p[1]',
      tagName: 'p',
      html: '<p class="faint">',
    });
  });

  it('collects every failed expectation as evidence', () => {
    const several = outcome({
      expectations: [
        ['1', { type: 'err', error: { message: 'First problem' } }],
        ['2', { type: 'ok' }],
        ['3', { type: 'err', error: { message: 'Second problem' } }],
      ],
    });

    const [finding] = normalizeAlfaResults(raw([{ outcome: several }]));
    expect(finding?.evidence).toEqual([
      { engineId: 'alfa', message: 'First problem', code: '1' },
      { engineId: 'alfa', message: 'Second problem', code: '3' },
    ]);
  });

  it('falls back to naming the rule when no expectation carries a message', () => {
    const silent = outcome({ expectations: [] });

    expect(normalizeAlfaResults(raw([{ outcome: silent }]))[0]?.title).toBe(
      'Alfa rule sia-r69 failed',
    );
  });

  it('classifies unlisted rules as other rather than guessing', () => {
    const unknown = outcome({
      rule: { uri: 'https://alfa.siteimprove.com/rules/sia-r9999', requirements: [] },
    });

    expect(normalizeAlfaResults(raw([{ outcome: unknown }]))[0]?.category).toBe('other');
  });

  it('returns nothing for a page with no failures', () => {
    expect(normalizeAlfaResults(raw([]))).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countIbmFailures, normalizeIbmResults } from './normalize.js';
import type { IbmIssue, IbmRawOutput } from './normalize.js';

/**
 * Fixtures are real IBM output, captured by `scripts/capture-fixtures.ts`.
 * Normalization is a pure function, so these tests never launch a browser.
 */
function fixture(name: string): IbmRawOutput {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as IbmRawOutput;
}

function issue(overrides: Partial<IbmIssue> = {}): IbmIssue {
  return {
    ruleId: 'text_contrast_sufficient',
    value: ['VIOLATION', 'FAIL'],
    path: { dom: '/html[1]/body[1]/main[1]/p[1]', aria: '/document[1]/main[1]/paragraph[1]' },
    message: 'Text contrast of 2.64 with its background is less than the WCAG AA minimum',
    snippet: '<p class="faint" id="faint-paragraph">',
    reasonId: 'fail_contrast',
    ...overrides,
  };
}

function raw(
  results: readonly IbmIssue[],
  ruleMappings: IbmRawOutput['ruleMappings'] = {
    text_contrast_sufficient: { criteria: [{ num: '1.4.3', level: 'AA' }] },
  },
): IbmRawOutput {
  return { guidelineId: 'IBM_Accessibility', numExecuted: 100, results, ruleMappings, counts: {} };
}

describe('normalizeIbmResults, on captured engine output', () => {
  it('finds the contrast failures on the contrast fixture', () => {
    const findings = normalizeIbmResults(fixture('contrast'));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.category === 'color-contrast')).toBe(true);
    expect(findings.every((finding) => finding.engineId === 'ibm-equal-access')).toBe(true);
  });

  it('gives every finding a canonical element path', () => {
    const findings = normalizeIbmResults(fixture('missing-label'));

    expect(findings.length).toBeGreaterThan(0);
    // Without a path there is nothing for deduplication to compare.
    for (const finding of findings) {
      expect(finding.target?.path).toMatch(/^\/html\[1\]/);
    }
  });

  it('maps success criteria from the engine’s own guideline data', () => {
    const findings = normalizeIbmResults(fixture('missing-label'));
    const withCriteria = findings.filter((finding) => finding.wcag.length > 0);

    expect(withCriteria.length).toBeGreaterThan(0);
    for (const criterion of withCriteria.flatMap((finding) => finding.wcag)) {
      expect(criterion.id).toMatch(/^\d\.\d{1,2}\.\d{1,2}$/);
      expect(criterion.level).toBeDefined();
    }
  });
});

describe('normalizeIbmResults', () => {
  it('maps a violation onto the Ally finding shape', () => {
    const [finding] = normalizeIbmResults(raw([issue()]));

    expect(finding).toMatchObject({
      id: 'ibm-equal-access:text_contrast_sufficient:1',
      engineId: 'ibm-equal-access',
      ruleId: 'text_contrast_sufficient',
      category: 'color-contrast',
      standard: 'wcag',
      severity: 'serious',
      rawSeverity: 'VIOLATION',
    });
    expect(finding?.wcag).toEqual([{ id: '1.4.3', level: 'AA', title: 'Contrast (Minimum)' }]);
  });

  it('reports only decided failures, never “needs review” outcomes', () => {
    const findings = normalizeIbmResults(
      raw([
        issue({ value: ['VIOLATION', 'FAIL'] }),
        issue({ value: ['VIOLATION', 'PASS'] }),
        issue({ value: ['VIOLATION', 'POTENTIAL'] }),
        issue({ value: ['VIOLATION', 'MANUAL'] }),
      ]),
    );

    // IBM's POTENTIAL and MANUAL are the same kind of thing as axe's
    // `incomplete`: a question, not an answer.
    expect(findings).toHaveLength(1);
  });

  it('maps IBM policy onto severity without inventing an impact level', () => {
    const forPolicy = (policy: IbmIssue['value'][0]) =>
      normalizeIbmResults(raw([issue({ value: [policy, 'FAIL'] })]))[0];

    expect(forPolicy('VIOLATION')?.severity).toBe('serious');
    expect(forPolicy('RECOMMENDATION')?.severity).toBe('minor');
    expect(forPolicy('INFORMATION')?.severity).toBe('info');

    // IBM grades rules by policy, not by user impact, so it never yields
    // `critical` on its own.
    expect(forPolicy('VIOLATION')?.severity).not.toBe('critical');
  });

  it('treats a recommendation as a best practice, not a WCAG failure', () => {
    const [finding] = normalizeIbmResults(raw([issue({ value: ['RECOMMENDATION', 'FAIL'] })]));

    expect(finding?.standard).toBe('best-practice');
  });

  it('classifies a violation with no criteria as unclassified', () => {
    const [finding] = normalizeIbmResults(raw([issue()], {}));

    expect(finding?.standard).toBe('unknown');
    expect(finding?.wcag).toEqual([]);
  });

  it('keeps IBM’s DOM path and snippet', () => {
    const [finding] = normalizeIbmResults(raw([issue()]));

    expect(finding?.target).toEqual({
      path: '/html[1]/body[1]/main[1]/p[1]',
      selector: '/html[1]/body[1]/main[1]/p[1]',
      html: '<p class="faint" id="faint-paragraph">',
    });
  });

  it('quotes the engine message as evidence, with its reason code', () => {
    const [finding] = normalizeIbmResults(raw([issue()]));

    expect(finding?.evidence).toEqual([
      {
        engineId: 'ibm-equal-access',
        message: 'Text contrast of 2.64 with its background is less than the WCAG AA minimum',
        code: 'fail_contrast',
      },
    ]);
  });

  it('links to IBM’s rule documentation', () => {
    const [finding] = normalizeIbmResults(raw([issue()]));

    expect(finding?.helpUrl).toContain('text_contrast_sufficient');
  });

  it('classifies unlisted rules as other rather than guessing', () => {
    const [finding] = normalizeIbmResults(raw([issue({ ruleId: 'a_rule_ally_does_not_know' })]));

    expect(finding?.category).toBe('other');
  });

  it('numbers findings so two results of one rule stay distinguishable', () => {
    const findings = normalizeIbmResults(
      raw([issue(), issue({ path: { dom: '/html[1]/body[1]/main[1]/p[2]' } })]),
    );

    expect(findings.map((finding) => finding.id)).toEqual([
      'ibm-equal-access:text_contrast_sufficient:1',
      'ibm-equal-access:text_contrast_sufficient:2',
    ]);
  });

  it('returns nothing for a page with no failures', () => {
    expect(normalizeIbmResults(raw([]))).toEqual([]);
  });
});

describe('countIbmFailures', () => {
  it('counts only decided failures', () => {
    const results = [
      issue({ value: ['VIOLATION', 'FAIL'] }),
      issue({ value: ['VIOLATION', 'PASS'] }),
      issue({ value: ['RECOMMENDATION', 'FAIL'] }),
    ];

    expect(countIbmFailures(results)).toBe(2);
  });
});

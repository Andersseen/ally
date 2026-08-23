import { describe, expect, test } from 'vitest';
import { criterionFromCode, normalizeHtmlCsResults, toSeverity } from './normalize.js';
import type { HtmlCsRawOutput } from './normalize.js';

const RAW: HtmlCsRawOutput = {
  standard: 'WCAG2AA',
  messages: [
    {
      type: 1,
      typeName: 'error',
      message: 'Img element missing an alt attribute.',
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      target: {
        path: '/html[1]/body[1]/img[1]',
        html: '<img src="logo.png">',
        tagName: 'img',
      },
    },
    {
      type: 2,
      typeName: 'warning',
      message: 'Check that the title element describes the document.',
      code: 'WCAG2AA.Principle2.Guideline2_4.2_4_2.H25.2',
      target: {
        path: '/html[1]/head[1]/title[1]',
        html: '<title>',
        tagName: 'title',
      },
    },
  ],
};

describe('normalizeHtmlCsResults', () => {
  test('maps severity from HTML_CodeSniffer message types', () => {
    expect(toSeverity(1)).toBe('serious');
    expect(toSeverity(2)).toBe('moderate');
    expect(toSeverity(3)).toBe('minor');
  });

  test('extracts explicit WCAG criteria from HTML_CodeSniffer codes', () => {
    expect(criterionFromCode('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37')).toMatchObject({
      id: '1.1.1',
      level: 'A',
    });
  });

  test('normalizes messages without launching a browser', () => {
    const findings = normalizeHtmlCsResults(RAW);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      engineId: 'htmlcs',
      ruleId: '1.1.1',
      category: 'text-alternatives',
      standard: 'wcag',
      severity: 'serious',
      wcag: [{ id: '1.1.1', level: 'A' }],
      target: { path: '/html[1]/body[1]/img[1]', tagName: 'img' },
    });
    expect(findings[1]).toMatchObject({
      ruleId: '2.4.2',
      category: 'page-title',
      severity: 'moderate',
    });
  });
});

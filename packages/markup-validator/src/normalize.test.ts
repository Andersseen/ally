import { describe, expect, test } from 'vitest';
import { normalizeVnuOutput, parseVnuJson, toSeverity } from './normalize.js';

describe('normalizeVnuOutput', () => {
  test('maps v.Nu message severities', () => {
    expect(toSeverity({ type: 'error' })).toBe('error');
    expect(toSeverity({ type: 'info', subType: 'warning' })).toBe('warning');
    expect(toSeverity({ type: 'info' })).toBe('info');
  });

  test('keeps markup issues separate from accessibility findings', () => {
    const result = normalizeVnuOutput({
      messages: [
        {
          type: 'error',
          message: 'Element “img” is missing required attribute “alt”.',
          firstLine: 4,
          firstColumn: 10,
          extract: '<img src="logo.png">',
        },
        { type: 'info', subType: 'warning', message: 'Consider adding a lang attribute.' },
      ],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      severity: 'error',
      line: 4,
      column: 10,
      source: 'nu-html-checker',
    });
  });

  test('parses empty output as no messages', () => {
    expect(parseVnuJson('')).toEqual({ messages: [] });
  });
});

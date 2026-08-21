import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countQualwebFailures, normalizeQualwebResults, qualwebPointersOf } from './normalize.js';
import type { QualwebAssertion, QualwebModuleReport, QualwebRawOutput } from './normalize.js';

/**
 * Fixtures are real QualWeb output, captured by `scripts/capture-fixtures.ts`.
 * Normalization is a pure function, so these tests never launch a browser.
 */
function fixture(name: string): QualwebRawOutput {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as QualwebRawOutput;
}

function assertion(overrides: Partial<QualwebAssertion> = {}): QualwebAssertion {
  return {
    code: 'QW-ACT-R11',
    name: 'Button has accessible name',
    description: 'This rule checks that each button element has an accessible name.',
    mapping: '97a4e1',
    metadata: {
      'success-criteria': [{ name: '4.1.2', level: 'A' }],
      url: 'https://www.w3.org/WAI/standards-guidelines/act/rules/97a4e1/',
      outcome: 'failed',
    },
    results: [
      {
        verdict: 'failed',
        description: "The test target doesn't have an accessible name.",
        resultCode: 'F1',
        elements: [
          {
            pointer: 'html > body > main > button',
            htmlCode: '<button type="submit"></button>',
            accessibleName: '',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function raw(
  assertions: readonly QualwebAssertion[],
  options: { bestPractice?: boolean; paths?: Record<string, string> } = {},
): QualwebRawOutput {
  const module: QualwebModuleReport = {
    moduleId: options.bestPractice === true ? 'best-practices' : 'act-rules',
    bestPractice: options.bestPractice ?? false,
    assertions: Object.fromEntries(assertions.map((item) => [item.code, item])),
  };

  return {
    engineVersions: { 'act-rules': '0.8.5' },
    modules: [module],
    paths: options.paths ?? { 'html > body > main > button': '/html[1]/body[1]/main[1]/button[1]' },
  };
}

describe('normalizeQualwebResults, on captured engine output', () => {
  it('finds the missing accessible names on the missing-label fixture', () => {
    const findings = normalizeQualwebResults(fixture('missing-label'));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.engineId === 'qualweb')).toBe(true);
  });

  it('resolves element pointers to canonical paths', () => {
    const findings = normalizeQualwebResults(fixture('missing-label'));
    const located = findings.filter((finding) => finding.target?.path !== undefined);

    expect(located.length).toBeGreaterThan(0);
    for (const finding of located) {
      expect(finding.target?.path).toMatch(/^\/html\[1\]/);
    }
  });

  it('reads success criteria with the levels QualWeb states', () => {
    const findings = normalizeQualwebResults(fixture('missing-label'));
    const criteria = findings.flatMap((finding) => finding.wcag);

    expect(criteria.length).toBeGreaterThan(0);
    for (const criterion of criteria) {
      expect(criterion.id).toMatch(/^\d\.\d{1,2}\.\d{1,2}$/);
      expect(criterion.level).toBeDefined();
    }
  });

  it('never carries a megabyte of markup into a finding', () => {
    const findings = normalizeQualwebResults(fixture('missing-label'));

    // QualWeb sets `htmlCode` to the target's full outerHTML; the adapter caps
    // it, and the normalizer truncates again for display.
    for (const finding of findings) {
      expect((finding.target?.html ?? '').length).toBeLessThanOrEqual(401);
    }
  });
});

describe('normalizeQualwebResults', () => {
  it('maps an assertion onto the Ally finding shape', () => {
    const [finding] = normalizeQualwebResults(raw([assertion()]));

    expect(finding).toMatchObject({
      id: 'qualweb:QW-ACT-R11:1',
      engineId: 'qualweb',
      ruleId: 'QW-ACT-R11',
      category: 'name-role-value',
      standard: 'wcag',
      severity: 'moderate',
      rawSeverity: 'failed',
      title: 'Button has accessible name',
      helpUrl: 'https://www.w3.org/WAI/standards-guidelines/act/rules/97a4e1/',
    });
    expect(finding?.wcag).toEqual([{ id: '4.1.2', level: 'A', title: 'Name, Role, Value' }]);
  });

  it('reports only failed verdicts, never warnings', () => {
    const findings = normalizeQualwebResults(
      raw([
        assertion({
          results: [
            { verdict: 'failed', description: 'a', elements: [{ pointer: 'x' }] },
            { verdict: 'warning', description: 'b', elements: [{ pointer: 'y' }] },
            { verdict: 'passed', description: 'c', elements: [{ pointer: 'z' }] },
            { verdict: 'inapplicable', description: 'd', elements: [] },
          ],
        }),
      ]),
    );

    // A warning is QualWeb asking a question, not answering one.
    expect(findings).toHaveLength(1);
  });

  it('splits one result across the elements it names', () => {
    const findings = normalizeQualwebResults(
      raw([
        assertion({
          results: [
            {
              verdict: 'failed',
              description: 'No accessible name',
              elements: [{ pointer: 'button#a' }, { pointer: 'button#b' }],
            },
          ],
        }),
      ]),
    );

    // Deduplication compares problems element by element, so each element is
    // its own finding.
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.target?.selector)).toEqual(['button#a', 'button#b']);
  });

  it('attaches the canonical path the adapter resolved', () => {
    const [finding] = normalizeQualwebResults(raw([assertion()]));

    expect(finding?.target).toMatchObject({
      path: '/html[1]/body[1]/main[1]/button[1]',
      selector: 'html > body > main > button',
      html: '<button type="submit"></button>',
    });
  });

  it('reports no path when the pointer could not be resolved', () => {
    const [finding] = normalizeQualwebResults(raw([assertion()], { paths: {} }));

    expect(finding?.target?.path).toBeUndefined();
    expect(finding?.target?.selector).toBe('html > body > main > button');
  });

  it('records the accessible name QualWeb reports, when there is one', () => {
    const [finding] = normalizeQualwebResults(
      raw([
        assertion({
          results: [
            {
              verdict: 'failed',
              description: 'x',
              elements: [{ pointer: 'a', accessibleName: 'Read more' }],
            },
          ],
        }),
      ]),
    );

    expect(finding?.target?.label).toBe('Read more');
  });

  it('classifies the best-practices module as best practice', () => {
    const [finding] = normalizeQualwebResults(
      raw([assertion({ code: 'QW-BP2' })], { bestPractice: true }),
    );

    expect(finding?.standard).toBe('best-practice');
    expect(finding?.severity).toBe('minor');
  });

  it('classifies a rule with no criteria as unclassified', () => {
    const [finding] = normalizeQualwebResults(
      raw([assertion({ metadata: { 'success-criteria': [], outcome: 'failed' } })]),
    );

    expect(finding?.standard).toBe('unknown');
  });

  it('quotes the result description as evidence with its result code', () => {
    const [finding] = normalizeQualwebResults(raw([assertion()]));

    expect(finding?.evidence).toEqual([
      {
        engineId: 'qualweb',
        message: "The test target doesn't have an accessible name.",
        code: 'F1',
      },
    ]);
  });

  it('classifies unlisted rules as other rather than guessing', () => {
    const [finding] = normalizeQualwebResults(raw([assertion({ code: 'QW-ACT-R999' })]));

    expect(finding?.category).toBe('other');
  });

  it('returns nothing for a page with no failures', () => {
    expect(normalizeQualwebResults(raw([]))).toEqual([]);
  });
});

describe('countQualwebFailures', () => {
  it('counts failed elements, not failed rules', () => {
    const modules = raw([
      assertion({
        results: [
          { verdict: 'failed', description: 'x', elements: [{ pointer: 'a' }, { pointer: 'b' }] },
          { verdict: 'passed', description: 'y', elements: [{ pointer: 'c' }] },
        ],
      }),
    ]).modules;

    expect(countQualwebFailures(modules)).toBe(2);
  });

  it('counts a failure with no named element as one', () => {
    const modules = raw([
      assertion({ results: [{ verdict: 'failed', description: 'page-level', elements: [] }] }),
    ]).modules;

    expect(countQualwebFailures(modules)).toBe(1);
  });
});

describe('qualwebPointersOf', () => {
  it('collects every element pointer for path resolution', () => {
    const modules = raw([
      assertion({
        results: [
          { verdict: 'failed', description: 'x', elements: [{ pointer: 'a' }, { pointer: '' }] },
          { verdict: 'passed', description: 'y', elements: [{ pointer: 'b' }] },
        ],
      }),
    ]).modules;

    // Passed results are included: resolving a pointer is cheap, and skipping
    // them would couple path resolution to the normalizer's filtering rules.
    expect(qualwebPointersOf(modules)).toEqual(['a', 'b']);
  });
});

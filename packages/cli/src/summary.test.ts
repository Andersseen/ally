import { describe, expect, it } from 'vitest';
import type { AuditResult, EngineRun, KeyboardReport } from '@ally/core';
import { formatSummary } from './summary.js';

function result(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    schemaVersion: 2,
    target: { url: 'https://example.com/' },
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:06.000Z',
    durationMs: 6000,
    engines: [],
    contributions: [],
    findings: [],
    score: {
      value: 82,
      version: 1,
      penalty: 8.8,
      breakdown: [],
      findingCount: 19,
      groupCount: 9,
    },
    coverage: { enginesConfigured: 4, enginesSucceeded: 4, keyboardAnalysis: 'ok' },
    summary: {
      totalFindings: 47,
      uniqueFindings: 19,
      bySeverity: { critical: 1, serious: 5, moderate: 8, minor: 5, info: 0 },
      byStandard: { wcag: 15, 'best-practice': 4, unknown: 0 },
      enginesSucceeded: 4,
      enginesFailed: 0,
    },
    dedupeVersion: 1,
    ...overrides,
  };
}

const failedEngine: EngineRun = {
  status: 'failed',
  engine: {
    id: 'qualweb',
    name: 'QualWeb',
    homepage: 'https://github.com/qualweb/core',
    license: 'ISC',
  },
  durationMs: 310,
  error: { message: 'The QualWeb bundle did not install `ACTRulesRunner`.\n  at run()' },
};

const keyboard: KeyboardReport = {
  status: 'ok',
  durationMs: 120,
  budget: { maxTabPresses: 120, maxShiftTabPresses: 30, timeoutMs: 20_000 },
  expected: [],
  forward: { stops: [], keyPresses: 0, stoppedBecause: 'completed' },
  reverse: { stops: [], keyPresses: 0, stoppedBecause: 'completed' },
  anomalies: [
    { kind: 'positive-tabindex', elements: [], detail: 'why' },
    { kind: 'focus-loss', elements: [], detail: 'why' },
  ],
};

describe('formatSummary', () => {
  it('reports the headline numbers', () => {
    const text = formatSummary({
      result: result({ keyboard }),
      auditFile: '/work/audit/audit.json',
      reportEntry: '/work/audit/report/index.html',
      unknownEngines: [],
    });

    expect(text).toContain('https://example.com/');
    expect(text).toContain('82 / 100');
    expect(text).toContain('4/4');
    expect(text).toContain('47');
    expect(text).toContain('19');
    expect(text).toContain('/work/audit/report/index.html');
  });

  it('counts keyboard warnings', () => {
    const text = formatSummary({
      result: result({ keyboard }),
      auditFile: '/work/audit/audit.json',
      unknownEngines: [],
    });

    expect(text).toMatch(/Keyboard warnings\s+2/);
  });

  it('says when the keyboard analysis did not run', () => {
    const text = formatSummary({
      result: result(),
      auditFile: '/work/audit/audit.json',
      unknownEngines: [],
    });

    expect(text).toMatch(/Keyboard warnings\s+not run/);
  });

  it('names engines that failed, on one line each', () => {
    const text = formatSummary({
      result: result({
        engines: [failedEngine],
        coverage: { enginesConfigured: 4, enginesSucceeded: 3, keyboardAnalysis: 'ok' },
      }),
      auditFile: '/work/audit/audit.json',
      unknownEngines: [],
    });

    expect(text).toContain('Engines that failed');
    expect(text).toContain('QualWeb: The QualWeb bundle did not install `ACTRulesRunner`.');
    // A stack trace belongs in the artifact, not in the terminal summary.
    expect(text).not.toContain('at run()');
    expect(text).toContain('3/4');
  });

  it('mentions engine ids it did not recognise', () => {
    const text = formatSummary({
      result: result(),
      auditFile: '/work/audit/audit.json',
      unknownEngines: ['pa11y'],
    });

    expect(text).toContain('Unknown engine ids ignored: pa11y');
  });

  it('explains why the report is missing rather than staying silent', () => {
    const text = formatSummary({
      result: result(),
      auditFile: '/work/audit/audit.json',
      reportProblem: 'astro build exited with code 1',
      unknownEngines: [],
    });

    expect(text).toContain('Not built — astro build exited with code 1');
  });

  it('never claims conformance, and says so explicitly', () => {
    const text = formatSummary({
      result: result(),
      auditFile: '/work/audit/audit.json',
      unknownEngines: [],
    });

    expect(text).toContain('does not establish WCAG');
    expect(text.toLowerCase()).not.toContain('compliant');
    expect(text.toLowerCase()).not.toContain('certif');
  });
});

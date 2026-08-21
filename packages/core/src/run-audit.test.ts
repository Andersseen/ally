import { describe, expect, it } from 'vitest';
import type { AuditContext, AuditEngine } from './engine.js';
import type { NormalizedFinding } from './finding.js';
import type { KeyboardAnalysis, KeyboardAnalyzer } from './keyboard.js';
import { runAudit } from './run-audit.js';
import type { Severity } from './severity.js';

interface TestPage {
  readonly marker: string;
}

const FROZEN_MS = 1_700_000_000_000;
const frozenClock = () => FROZEN_MS;

const context: AuditContext<TestPage> = {
  url: 'https://example.com/',
  page: { marker: 'test-page' },
};

let ordinal = 0;

function finding(
  engineId: string,
  ruleId: string,
  severity: Severity,
  path?: string,
): NormalizedFinding {
  ordinal += 1;
  return {
    id: `${engineId}:${ruleId}:${ordinal}`,
    engineId,
    ruleId,
    category: 'color-contrast',
    standard: 'wcag',
    severity,
    title: `${ruleId} failed`,
    wcag: [{ id: '1.4.3', level: 'AA' }],
    ...(path === undefined ? {} : { target: { path } }),
    evidence: [],
  };
}

function fakeEngine(
  id: string,
  findings: readonly NormalizedFinding[],
): AuditEngine<TestPage, { readonly findings: readonly NormalizedFinding[] }> {
  return {
    id,
    name: `Fake ${id}`,
    homepage: `https://example.com/${id}`,
    license: 'MIT',
    run: () => Promise.resolve({ raw: { findings }, rawCount: findings.length, version: '1.2.3' }),
    normalize: (raw) => raw.findings,
  };
}

function failingEngine(id: string, error: Error): AuditEngine<TestPage, never> {
  return {
    id,
    name: `Failing ${id}`,
    homepage: `https://example.com/${id}`,
    license: 'MIT',
    run: () => Promise.reject(error),
    normalize: () => [],
  };
}

function keyboardAnalyzer(
  analysis: KeyboardAnalysis,
  findings: readonly NormalizedFinding[] = [],
): KeyboardAnalyzer<TestPage> {
  return {
    id: 'keyboard',
    name: 'Ally keyboard analyzer',
    homepage: 'https://example.com/keyboard',
    license: 'Apache-2.0',
    analyze: () => Promise.resolve(analysis),
    toFindings: () => findings,
  };
}

const analysis: KeyboardAnalysis = {
  status: 'ok',
  durationMs: 120,
  budget: { maxTabPresses: 100, maxShiftTabPresses: 25, timeoutMs: 15_000 },
  expected: [{ path: '/html[1]/body[1]/a[1]', tagName: 'a', label: 'Home' }],
  forward: {
    stops: [
      { path: '/html[1]/body[1]/a[1]', tagName: 'a', label: 'Home', order: 1, expected: true },
    ],
    keyPresses: 1,
    stoppedBecause: 'completed',
  },
  reverse: { stops: [], keyPresses: 0, stoppedBecause: 'completed' },
  anomalies: [],
};

describe('runAudit', () => {
  it('aggregates findings from every engine and summarizes them by severity', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [
        fakeEngine('alpha', [finding('alpha', 'image-alt', 'critical', '/html[1]/img[1]')]),
        fakeEngine('beta', [
          finding('beta', 'color-contrast', 'serious', '/html[1]/p[1]'),
          finding('beta', 'region', 'moderate', '/html[1]/div[1]'),
        ]),
      ],
    });

    expect(result.summary.totalFindings).toBe(3);
    expect(result.summary.uniqueFindings).toBe(3);
    expect(result.summary.bySeverity).toEqual({
      critical: 1,
      serious: 1,
      moderate: 1,
      minor: 0,
      info: 0,
    });
    expect(result.summary.enginesSucceeded).toBe(2);
    expect(result.summary.enginesFailed).toBe(0);
  });

  it('deduplicates the same problem seen by two engines', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [
        fakeEngine('alpha', [finding('alpha', 'color-contrast', 'serious', '/html[1]/p[1]')]),
        fakeEngine('beta', [finding('beta', 'contrast', 'moderate', '/html[1]/p[1]')]),
      ],
    });

    expect(result.summary.totalFindings).toBe(2);
    expect(result.summary.uniqueFindings).toBe(1);
    expect(result.findings[0]?.engineAgreement).toBe(2);
  });

  it('records a failing engine without losing the other engines results', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [
        failingEngine('broken', new Error('engine crashed')),
        fakeEngine('healthy', [finding('healthy', 'image-alt', 'critical')]),
      ],
    });

    const [broken, healthy] = result.engines;
    expect(broken?.status).toBe('failed');
    expect(broken?.status === 'failed' ? broken.error.message : undefined).toBe('engine crashed');
    expect(healthy?.status).toBe('ok');
    expect(result.findings).toHaveLength(1);
    expect(result.summary.enginesFailed).toBe(1);
    expect(result.summary.enginesSucceeded).toBe(1);
  });

  it('treats a failed engine as missing coverage, never as a finding', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [failingEngine('broken', new Error('nope')), fakeEngine('healthy', [])],
    });

    expect(result.score.value).toBe(100);
    expect(result.coverage).toEqual({
      enginesConfigured: 2,
      enginesSucceeded: 1,
      keyboardAnalysis: 'skipped',
    });
  });

  it('reports what each engine contributed', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [
        fakeEngine('alpha', [
          finding('alpha', 'color-contrast', 'serious', '/html[1]/p[1]'),
          finding('alpha', 'image-alt', 'critical', '/html[1]/img[1]'),
        ]),
        fakeEngine('beta', [finding('beta', 'contrast', 'serious', '/html[1]/p[1]')]),
      ],
    });

    const [alpha, beta] = result.contributions;
    expect(alpha).toMatchObject({
      engineId: 'alpha',
      status: 'ok',
      rawFindings: 2,
      normalizedFindings: 2,
      uniqueContributions: 1,
      sharedContributions: 1,
    });
    expect(beta).toMatchObject({
      engineId: 'beta',
      uniqueContributions: 0,
      sharedContributions: 1,
    });
  });

  it('carries an engine note through to the artifact', async () => {
    const degraded: AuditEngine<TestPage, null> = {
      id: 'partial',
      name: 'Partially working',
      homepage: 'https://example.com/partial',
      license: 'MIT',
      run: () =>
        Promise.resolve({
          raw: null,
          rawCount: 2,
          notes: ['The act-rules module did not run: it threw.'],
        }),
      normalize: () => [],
    };

    const { result } = await runAudit({ context, clock: frozenClock, engines: [degraded] });
    const [run] = result.engines;

    // An engine that ran but lost part of itself is neither `ok` nor `failed`
    // on its own — the run succeeded, with less coverage than intended.
    expect(run?.status).toBe('ok');
    expect(run?.status === 'ok' ? run.notes : undefined).toEqual([
      'The act-rules module did not run: it threw.',
    ]);
    expect(result.summary.enginesSucceeded).toBe(1);
    expect(result.summary.enginesFailed).toBe(0);
  });

  it('omits notes entirely when a run was not degraded', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [fakeEngine('alpha', [])],
    });

    expect(result.engines[0]).not.toHaveProperty('notes');
  });

  it('records the engine version an adapter resolved at run time', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [fakeEngine('alpha', [])],
    });

    expect(result.engines[0]?.engine.version).toBe('1.2.3');
  });

  it('keeps raw engine output out of the normalized result', async () => {
    const { result, raw } = await runAudit({
      context,
      clock: frozenClock,
      engines: [fakeEngine('alpha', [finding('alpha', 'image-alt', 'minor')])],
    });

    expect([...raw.keys()]).toEqual(['alpha']);
    expect(JSON.stringify(result)).not.toContain('"raw"');
  });

  it('does not store raw output for an engine that failed', async () => {
    const { raw } = await runAudit({
      context,
      clock: frozenClock,
      engines: [failingEngine('broken', new Error('nope'))],
    });

    expect(raw.has('broken')).toBe(false);
  });

  it('includes keyboard analysis and its findings when an analyzer is supplied', async () => {
    const anomaly = finding('keyboard', 'positive-tabindex', 'moderate', '/html[1]/button[1]');
    const { result, raw } = await runAudit({
      context,
      clock: frozenClock,
      engines: [],
      keyboard: keyboardAnalyzer(analysis, [anomaly]),
    });

    expect(result.keyboard?.status).toBe('ok');
    expect(result.summary.keyboard).toEqual({
      expectedTabbable: 1,
      observedStops: 1,
      anomalies: 0,
      stoppedBecause: 'completed',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.coverage.keyboardAnalysis).toBe('ok');
    expect(raw.has('keyboard')).toBe(true);
  });

  it('records a failing keyboard analyzer without failing the audit', async () => {
    const analyzer: KeyboardAnalyzer<TestPage> = {
      ...keyboardAnalyzer(analysis),
      analyze: () => Promise.reject(new Error('focus never settled')),
    };

    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [fakeEngine('alpha', [finding('alpha', 'image-alt', 'minor')])],
      keyboard: analyzer,
    });

    expect(result.keyboard?.status).toBe('failed');
    expect(result.keyboard?.status === 'failed' ? result.keyboard.error.message : '').toBe(
      'focus never settled',
    );
    expect(result.coverage.keyboardAnalysis).toBe('failed');
    expect(result.findings).toHaveLength(1);
  });

  it('derives timestamps from the injected clock', async () => {
    const { result } = await runAudit({ context, clock: frozenClock, engines: [] });

    expect(result.startedAt).toBe(new Date(FROZEN_MS).toISOString());
    expect(result.finishedAt).toBe(new Date(FROZEN_MS).toISOString());
    expect(result.durationMs).toBe(0);
    expect(result.target.url).toBe('https://example.com/');
  });

  it('passes the audit context through to each engine', async () => {
    let seen: AuditContext<TestPage> | undefined;
    const spy: AuditEngine<TestPage, null> = {
      id: 'spy',
      name: 'Spy',
      homepage: 'https://example.com/spy',
      license: 'MIT',
      run: (received) => {
        seen = received;
        return Promise.resolve({ raw: null, rawCount: 0 });
      },
      normalize: () => [],
    };

    await runAudit({ context, clock: frozenClock, engines: [spy] });

    expect(seen?.page.marker).toBe('test-page');
    expect(seen?.url).toBe('https://example.com/');
  });
});

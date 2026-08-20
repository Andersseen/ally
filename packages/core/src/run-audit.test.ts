import { describe, expect, it } from 'vitest';
import type { AuditContext, AuditEngine } from './engine.js';
import type { NormalizedFinding } from './finding.js';
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

function finding(engineId: string, ruleId: string, severity: Severity): NormalizedFinding {
  return {
    id: `${engineId}:${ruleId}`,
    engineId,
    ruleId,
    severity,
    title: `${ruleId} failed`,
    wcag: [],
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
    run: () => Promise.resolve({ findings }),
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

describe('runAudit', () => {
  it('aggregates findings from every engine and summarizes them by severity', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [
        fakeEngine('alpha', [finding('alpha', 'image-alt', 'critical')]),
        fakeEngine('beta', [
          finding('beta', 'color-contrast', 'serious'),
          finding('beta', 'region', 'moderate'),
        ]),
      ],
    });

    expect(result.findings).toHaveLength(3);
    expect(result.summary.totalFindings).toBe(3);
    expect(result.summary.bySeverity).toEqual({
      critical: 1,
      serious: 1,
      moderate: 1,
      minor: 0,
    });
    expect(result.summary.enginesSucceeded).toBe(2);
    expect(result.summary.enginesFailed).toBe(0);
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

  it('reports unique findings as unknown until deduplication exists', async () => {
    const { result } = await runAudit({
      context,
      clock: frozenClock,
      engines: [fakeEngine('alpha', [finding('alpha', 'image-alt', 'minor')])],
    });

    expect(result.summary.uniqueFindings).toBeNull();
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
        return Promise.resolve(null);
      },
      normalize: () => [],
    };

    await runAudit({ context, clock: frozenClock, engines: [spy] });

    expect(seen?.page.marker).toBe('test-page');
    expect(seen?.url).toBe('https://example.com/');
  });
});

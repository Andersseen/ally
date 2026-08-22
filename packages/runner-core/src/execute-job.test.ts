import type { Page } from '@ally/browser';
import { BrowserError } from '@ally/browser';
import type { AuditStageEvent } from '@ally/core';
import { describe, expect, test } from 'vitest';
import type { BrowserProvider, BrowserProviderOptions } from './browser-provider.js';
import { executeAuditJob } from './execute-job.js';
import type { AuditBudgets, AuditJob, ClaimResult, RunnerPersistencePort } from './ports.js';

const BUDGETS: AuditBudgets = {
  navigationTimeoutMs: 5_000,
  auditTimeoutMs: 5_000,
  maxRedirects: 5,
};

function job(overrides: Partial<AuditJob> = {}): AuditJob {
  return { id: 'audit-1', url: 'https://example.com/', attempt: 1, ...overrides };
}

interface RecordingPersistence extends RunnerPersistencePort {
  readonly calls: string[];
  readonly stageEvents: AuditStageEvent[];
  readonly failures: { category: string; message: string }[];
}

function fakePersistence(claimResult: ClaimResult = 'claimed'): RecordingPersistence {
  const calls: string[] = [];
  const stageEvents: AuditStageEvent[] = [];
  const failures: { category: string; message: string }[] = [];

  return {
    calls,
    stageEvents,
    failures,
    claim: () => {
      calls.push('claim');
      return Promise.resolve(claimResult);
    },
    markRunning: () => {
      calls.push('markRunning');
      return Promise.resolve();
    },
    reportStage: (_received, event) => {
      calls.push('reportStage');
      stageEvents.push(event);
      return Promise.resolve();
    },
    markPersisting: () => {
      calls.push('markPersisting');
      return Promise.resolve();
    },
    complete: () => {
      calls.push('complete');
      return Promise.resolve();
    },
    fail: (_received, category, message) => {
      calls.push('fail');
      failures.push({ category, message });
      return Promise.resolve();
    },
  };
}

/**
 * Runs through the real `@ally/audit-runner` -> `@ally/core` pipeline
 * against a fake page. Every real engine will fail immediately (the fake
 * page has none of the methods they call), which `runAudit` records as a
 * failed `EngineRun` rather than throwing — exactly the behaviour under
 * test: `executeAuditJob`'s orchestration must not care whether individual
 * engines succeeded, only whether the job as a whole threw. A genuinely
 * successful run against real content is proven separately by the
 * hosted-style integration test against `@ally/fixtures`.
 */
function immediatePageProvider(): BrowserProvider {
  return {
    open: <T>(_options: BrowserProviderOptions, use: (page: Page) => Promise<T>) =>
      use({} as unknown as Page),
  };
}

function throwingProvider(error: Error): BrowserProvider {
  return {
    open: <T>() => Promise.reject<T>(error),
  };
}

function hangingProvider(): BrowserProvider {
  return {
    open: <T>() => new Promise<T>(() => undefined),
  };
}

describe('executeAuditJob', () => {
  test('runs the real pipeline end to end: claim -> running -> stages -> persisting -> complete', async () => {
    const persistence = fakePersistence();

    const outcome = await executeAuditJob(job(), {
      browserProvider: immediatePageProvider(),
      persistence,
      budgets: BUDGETS,
    });

    expect(outcome).toBe('completed');
    expect(persistence.calls[0]).toBe('claim');
    expect(persistence.calls).toContain('markRunning');
    expect(persistence.calls).toContain('markPersisting');
    expect(persistence.calls.at(-1)).toBe('complete');
    expect(persistence.calls).not.toContain('fail');

    // Every engine (and the keyboard analyzer) failed against the fake page,
    // but the job still completed — a broken engine never fails the audit.
    expect(persistence.stageEvents.length).toBeGreaterThan(0);
    expect(persistence.stageEvents.some((event) => event.status === 'started')).toBe(true);
  });

  test('skips execution when the job has already reached a terminal state', async () => {
    const persistence = fakePersistence('terminal');
    let browserOpened = false;

    const outcome = await executeAuditJob(job(), {
      browserProvider: {
        open: <T>(_options: BrowserProviderOptions, use: (page: Page) => Promise<T>) => {
          browserOpened = true;
          return use({} as unknown as Page);
        },
      },
      persistence,
      budgets: BUDGETS,
    });

    expect(outcome).toBe('skipped');
    expect(browserOpened).toBe(false);
    expect(persistence.calls).toEqual(['claim']);
  });

  test('rejects a private-network URL before ever opening a browser', async () => {
    const persistence = fakePersistence();
    let browserOpened = false;

    const outcome = await executeAuditJob(job({ url: 'http://127.0.0.1:8080/' }), {
      browserProvider: {
        open: <T>(_options: BrowserProviderOptions, use: (page: Page) => Promise<T>) => {
          browserOpened = true;
          return use({} as unknown as Page);
        },
      },
      persistence,
      budgets: BUDGETS,
    });

    expect(outcome).toBe('failed');
    expect(browserOpened).toBe(false);
    expect(persistence.calls).not.toContain('markRunning');
    expect(persistence.failures[0]?.category).toBe('ssrf-blocked');
  });

  test('classifies a browser-provider failure and reports it without persisting a result', async () => {
    const persistence = fakePersistence();

    const outcome = await executeAuditJob(job(), {
      browserProvider: throwingProvider(new BrowserError('Could not open https://example.com/.')),
      persistence,
      budgets: BUDGETS,
    });

    expect(outcome).toBe('failed');
    expect(persistence.calls).toContain('markRunning');
    expect(persistence.calls).not.toContain('complete');
    expect(persistence.failures[0]).toMatchObject({
      category: 'browser-failure',
      message: 'Could not open https://example.com/.',
    });
  });

  test('fails with the audit-timeout category once the job exceeds its budget', async () => {
    const persistence = fakePersistence();

    const outcome = await executeAuditJob(job(), {
      browserProvider: hangingProvider(),
      persistence,
      budgets: { ...BUDGETS, auditTimeoutMs: 10 },
    });

    expect(outcome).toBe('failed');
    expect(persistence.failures[0]?.category).toBe('audit-timeout');
  });

  test('never persists a result for a job that ultimately failed', async () => {
    const persistence = fakePersistence();

    await executeAuditJob(job({ url: 'http://169.254.169.254/' }), {
      browserProvider: immediatePageProvider(),
      persistence,
      budgets: BUDGETS,
    });

    expect(persistence.calls).not.toContain('complete');
  });
});

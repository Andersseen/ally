import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AuditRun } from '@ally/core';
import type { AuditJob } from '@ally/runner-core';
import { createWorkerPersistence } from './worker-client.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function fetchSpy(response: Response) {
  return vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response));
}

function firstCall(mock: ReturnType<typeof fetchSpy>) {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('fetch was not called');
  return call;
}

const JOB: AuditJob = { id: 'audit-1', url: 'https://example.com/', attempt: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWorkerPersistence', () => {
  test('every call is authenticated with the runner bearer secret', async () => {
    const fetchMock = fetchSpy(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 'runner-secret',
      runnerId: 'runner-1',
    });

    await persistence.markRunning(JOB);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://ally.example/api/runner/audits/audit-1/running');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer runner-secret');
  });

  test('claim reports "claimed" unless the Worker says the job is terminal', async () => {
    const persistence = (terminal: boolean) => {
      vi.stubGlobal('fetch', fetchSpy(jsonResponse({ terminal })));
      return createWorkerPersistence({
        baseUrl: 'https://ally.example',
        secret: 's',
        runnerId: 'r',
      });
    };

    expect(await persistence(false).claim(JOB)).toBe('claimed');
    expect(await persistence(true).claim(JOB)).toBe('terminal');
  });

  test('claim sends the runner id', async () => {
    const fetchMock = fetchSpy(jsonResponse({ terminal: false }));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 's',
      runnerId: 'runner-42',
    });

    await persistence.claim(JOB);

    const [, init] = firstCall(fetchMock);
    expect(JSON.parse(init?.body as string)).toEqual({ runnerId: 'runner-42' });
  });

  test('reportStage forwards stage/status/durationMs', async () => {
    const fetchMock = fetchSpy(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 's',
      runnerId: 'r',
    });

    await persistence.reportStage(JOB, { stage: 'axe-core', status: 'ok', durationMs: 120 });

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://ally.example/api/runner/audits/audit-1/stage');
    expect(JSON.parse(init?.body as string)).toEqual({
      stage: 'axe-core',
      status: 'ok',
      durationMs: 120,
    });
  });

  test('complete sends the result and flattens the raw map into an object', async () => {
    const fetchMock = fetchSpy(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 's',
      runnerId: 'r',
    });

    const run = {
      result: { schemaVersion: 2 },
      raw: new Map([['axe-core', { violations: [] }]]),
    } as unknown as AuditRun;

    await persistence.complete(JOB, run);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://ally.example/api/runner/audits/audit-1/complete');
    expect(JSON.parse(init?.body as string)).toEqual({
      result: { schemaVersion: 2 },
      raw: { 'axe-core': { violations: [] } },
    });
  });

  test('fail sends the category and message', async () => {
    const fetchMock = fetchSpy(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 's',
      runnerId: 'r',
    });

    await persistence.fail(JOB, 'ssrf-blocked', 'Blocked.');

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://ally.example/api/runner/audits/audit-1/fail');
    expect(JSON.parse(init?.body as string)).toEqual({
      category: 'ssrf-blocked',
      message: 'Blocked.',
    });
  });

  test('throws with the action and status on a non-ok response', async () => {
    vi.stubGlobal('fetch', fetchSpy(jsonResponse({}, false, 503)));
    const persistence = createWorkerPersistence({
      baseUrl: 'https://ally.example',
      secret: 's',
      runnerId: 'r',
    });

    await expect(persistence.markPersisting(JOB)).rejects.toThrow(/persisting.*HTTP 503/);
  });
});

import { describe, expect, test } from 'vitest';
import { requireRunnerAuth, runnerAuthIsConfigured } from './runner-auth.js';

function requestWith(authorization?: string): Request {
  const headers = authorization === undefined ? {} : { authorization };
  return new Request('https://ally.example/api/runner/audits/1/claim', {
    method: 'POST',
    headers,
  });
}

describe('runnerAuthIsConfigured', () => {
  test('false when unset or blank', () => {
    expect(runnerAuthIsConfigured({})).toBe(false);
    expect(runnerAuthIsConfigured({ ALLY_RUNNER_SECRET: '' })).toBe(false);
    expect(runnerAuthIsConfigured({ ALLY_RUNNER_SECRET: '   ' })).toBe(false);
  });

  test('true when set', () => {
    expect(runnerAuthIsConfigured({ ALLY_RUNNER_SECRET: 'secret-value' })).toBe(true);
  });
});

describe('requireRunnerAuth', () => {
  test('503s every request when the secret is not configured, even a correct-looking one', async () => {
    const response = requireRunnerAuth(requestWith('Bearer anything'), {});
    expect(response).not.toBe(true);
    if (response === true) throw new Error('unreachable');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Runner authentication is not configured' });
  });

  test('401s a missing Authorization header', () => {
    const response = requireRunnerAuth(requestWith(), { ALLY_RUNNER_SECRET: 'secret-value' });
    expect(response).not.toBe(true);
    if (response === true) throw new Error('unreachable');
    expect(response.status).toBe(401);
  });

  test('401s a non-Bearer scheme', () => {
    const response = requireRunnerAuth(requestWith('Basic dXNlcjpwYXNz'), {
      ALLY_RUNNER_SECRET: 'secret-value',
    });
    expect(response).not.toBe(true);
  });

  test('401s an incorrect secret', () => {
    const response = requireRunnerAuth(requestWith('Bearer wrong-secret'), {
      ALLY_RUNNER_SECRET: 'secret-value',
    });
    expect(response).not.toBe(true);
  });

  test('401s an empty bearer token', () => {
    const response = requireRunnerAuth(requestWith('Bearer '), {
      ALLY_RUNNER_SECRET: 'secret-value',
    });
    expect(response).not.toBe(true);
  });

  test('authorizes the exact configured secret', () => {
    const response = requireRunnerAuth(requestWith('Bearer secret-value'), {
      ALLY_RUNNER_SECRET: 'secret-value',
    });
    expect(response).toBe(true);
  });

  test('rejects a secret that only differs in length', () => {
    const response = requireRunnerAuth(requestWith('Bearer secret-valueX'), {
      ALLY_RUNNER_SECRET: 'secret-value',
    });
    expect(response).not.toBe(true);
  });
});

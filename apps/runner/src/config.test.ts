import { describe, expect, test } from 'vitest';
import { loadRunnerConfig, loadRunnerServeConfig } from './config.js';

const VALID_ENV: NodeJS.ProcessEnv = {
  ALLY_WORKER_BASE_URL: 'https://ally.andersseen.dev/',
  ALLY_RUNNER_SECRET: 'runner-secret',
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_QUEUES_API_TOKEN: 'queues-token',
  CLOUDFLARE_QUEUE_ID: 'queue-id',
};

describe('loadRunnerConfig', () => {
  test('throws listing every missing required variable', () => {
    expect(() => loadRunnerConfig({})).toThrowError(
      /ALLY_WORKER_BASE_URL.*ALLY_RUNNER_SECRET.*CLOUDFLARE_ACCOUNT_ID.*CLOUDFLARE_QUEUES_API_TOKEN.*CLOUDFLARE_QUEUE_ID/s,
    );
  });

  test('treats a blank value the same as missing', () => {
    expect(() => loadRunnerConfig({ ...VALID_ENV, ALLY_RUNNER_SECRET: '   ' })).toThrow(
      'ALLY_RUNNER_SECRET',
    );
  });

  test('strips a trailing slash from the worker base URL', () => {
    const config = loadRunnerConfig(VALID_ENV);
    expect(config.workerBaseUrl).toBe('https://ally.andersseen.dev');
  });

  test('serve mode does not require standalone queue pull credentials', () => {
    const config = loadRunnerServeConfig({
      ALLY_WORKER_BASE_URL: 'https://ally.andersseen.dev/',
      ALLY_RUNNER_SECRET: 'runner-secret',
    });
    expect(config.workerBaseUrl).toBe('https://ally.andersseen.dev');
    expect(config.runnerSecret).toBe('runner-secret');
  });

  test('applies sane defaults for optional budgets and timing', () => {
    const config = loadRunnerConfig(VALID_ENV);
    expect(config.budgets).toEqual({
      navigationTimeoutMs: 30_000,
      auditTimeoutMs: 120_000,
      maxRedirects: 5,
    });
    expect(config.pollIntervalMs).toBe(2_000);
    expect(config.healthPort).toBe(8080);
  });

  test('derives the visibility timeout from the audit timeout when unset', () => {
    const config = loadRunnerConfig({ ...VALID_ENV, ALLY_AUDIT_TIMEOUT_MS: '90000' });
    expect(config.visibilityTimeoutMs).toBe(90_000 + 30_000);
  });

  test('honours an explicit visibility timeout override', () => {
    const config = loadRunnerConfig({ ...VALID_ENV, ALLY_QUEUE_VISIBILITY_TIMEOUT_MS: '999000' });
    expect(config.visibilityTimeoutMs).toBe(999_000);
  });

  test('generates a runner id when unset, and trims a provided one', () => {
    expect(loadRunnerConfig(VALID_ENV).runnerId).toMatch(/^runner-/);
    expect(loadRunnerConfig({ ...VALID_ENV, ALLY_RUNNER_ID: '  my-runner  ' }).runnerId).toBe(
      'my-runner',
    );
  });
});

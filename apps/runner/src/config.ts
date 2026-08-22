import { randomUUID } from 'node:crypto';
import type { AuditBudgets } from '@ally/runner-core';

export interface RunnerConfig {
  /** Origin of the Ally Worker, e.g. `https://ally.andersseen.dev`. No trailing slash. */
  readonly workerBaseUrl: string;
  /** Bearer secret for the Worker's `/api/runner/*` surface. */
  readonly runnerSecret: string;
  readonly runnerId: string;
  readonly cloudflareAccountId: string;
  /** Cloudflare API token scoped to Queues pull/ack on the audit queue only. */
  readonly cloudflareApiToken: string;
  readonly cloudflareQueueId: string;
  readonly budgets: AuditBudgets;
  /** How long to sleep after an empty pull before trying again. */
  readonly pollIntervalMs: number;
  /**
   * Requested queue lease duration. Must exceed `auditTimeoutMs` by a
   * healthy margin — the job execution timeout logically bounds a job, but
   * the queue's own visibility timeout must not expire and redeliver the
   * message to another puller while this runner still legitimately owns it.
   */
  readonly visibilityTimeoutMs: number;
  readonly healthPort: number;
}

const REQUIRED_VARS = [
  'ALLY_WORKER_BASE_URL',
  'ALLY_RUNNER_SECRET',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_QUEUES_API_TOKEN',
  'CLOUDFLARE_QUEUE_ID',
] as const;

/**
 * Reads and validates every environment variable the runner needs, failing
 * fast with one clear error listing everything missing — a hosted process
 * with half its configuration should refuse to start, not limp along.
 */
export function loadRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const missing = REQUIRED_VARS.filter((name) => isBlank(env[name]));
  if (missing.length > 0) {
    throw new Error(`Missing required runner environment variables: ${missing.join(', ')}`);
  }

  const budgets: AuditBudgets = {
    navigationTimeoutMs: readIntEnv(env, 'ALLY_NAVIGATION_TIMEOUT_MS', 30_000),
    auditTimeoutMs: readIntEnv(env, 'ALLY_AUDIT_TIMEOUT_MS', 120_000),
    maxRedirects: readIntEnv(env, 'ALLY_MAX_REDIRECTS', 5),
  };

  const runnerId = env.ALLY_RUNNER_ID;

  return {
    workerBaseUrl: requireVar(env, 'ALLY_WORKER_BASE_URL').replace(/\/$/, ''),
    runnerSecret: requireVar(env, 'ALLY_RUNNER_SECRET'),
    runnerId: isBlank(runnerId) ? defaultRunnerId() : runnerId.trim(),
    cloudflareAccountId: requireVar(env, 'CLOUDFLARE_ACCOUNT_ID'),
    cloudflareApiToken: requireVar(env, 'CLOUDFLARE_QUEUES_API_TOKEN'),
    cloudflareQueueId: requireVar(env, 'CLOUDFLARE_QUEUE_ID'),
    budgets,
    pollIntervalMs: readIntEnv(env, 'ALLY_QUEUE_POLL_INTERVAL_MS', 2_000),
    visibilityTimeoutMs: readIntEnv(
      env,
      'ALLY_QUEUE_VISIBILITY_TIMEOUT_MS',
      budgets.auditTimeoutMs + 30_000,
    ),
    healthPort: readIntEnv(env, 'ALLY_HEALTH_PORT', 8080),
  };
}

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (isBlank(value)) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function isBlank(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === '';
}

function readIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultRunnerId(): string {
  return `runner-${randomUUID().slice(0, 8)}`;
}

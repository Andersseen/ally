import { PlaywrightChromiumBrowserProvider, executeAuditJob, logEvent } from '@ally/runner-core';
import type { AuditJob } from '@ally/runner-core';
import { loadRunnerConfig } from './config.ts';
import { startHealthServer } from './health.ts';
import { parseJob } from './job.ts';
import { createCloudflareQueueClient } from './queue-client.ts';
import { createWorkerPersistence } from './worker-client.ts';

const config = loadRunnerConfig();
const queue = createCloudflareQueueClient({
  accountId: config.cloudflareAccountId,
  queueId: config.cloudflareQueueId,
  apiToken: config.cloudflareApiToken,
  visibilityTimeoutMs: config.visibilityTimeoutMs,
});
const persistence = createWorkerPersistence({
  baseUrl: config.workerBaseUrl,
  secret: config.runnerSecret,
  runnerId: config.runnerId,
});
const browserProvider = new PlaywrightChromiumBrowserProvider();
const health = startHealthServer(config.healthPort);

let shuttingDown = false;
process.once('SIGTERM', () => {
  logEvent('info', 'shutdown_requested', { runnerId: config.runnerId, signal: 'SIGTERM' });
  shuttingDown = true;
});
process.once('SIGINT', () => {
  logEvent('info', 'shutdown_requested', { runnerId: config.runnerId, signal: 'SIGINT' });
  shuttingDown = true;
});

logEvent('info', 'runner_starting', { runnerId: config.runnerId });
void loop();

/**
 * Pull → execute → ack/retry, forever, until a shutdown signal arrives —
 * checked between jobs, never mid-job, so an in-flight audit finishes
 * (bounded by `auditTimeoutMs`) instead of being torn down.
 */
async function loop(): Promise<void> {
  while (!shuttingDown) {
    let messages;
    try {
      messages = await queue.pull(1);
    } catch (error) {
      logEvent('error', 'queue_pull_failed', { error: errorMessage(error) });
      await sleep(config.pollIntervalMs);
      continue;
    }

    if (messages.length === 0) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    for (const message of messages) {
      const job = parseJob(message.body);
      if (job === null) {
        logEvent('error', 'queue_message_malformed', {});
        await queue.ack(message.leaseId).catch(() => undefined);
        continue;
      }

      await runOne(job, message.leaseId);
    }
  }

  await health.close();
  logEvent('info', 'runner_stopped', { runnerId: config.runnerId });
}

async function runOne(job: AuditJob, leaseId: string): Promise<void> {
  try {
    await executeAuditJob(job, { browserProvider, persistence, budgets: config.budgets });
    await queue.ack(leaseId);
  } catch (error) {
    // executeAuditJob only throws here for infrastructure failures it could
    // not itself report (e.g. the Worker was unreachable when persisting
    // failure) — never for an audit-domain failure, which it already
    // reported via `persistence.fail`. Let the queue's own redelivery retry
    // it rather than silently dropping the job.
    logEvent('error', 'job_execution_threw', { auditId: job.id, error: errorMessage(error) });
    await queue.retry(leaseId).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

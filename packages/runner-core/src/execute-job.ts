import { auditPage } from '@ally/audit-runner';
import type { AuditHooks } from '@ally/core';
import { assertSyntacticallyPublicUrl } from '@ally/net-guard';
import type { BrowserProvider } from './browser-provider.js';
import { AuditTimeoutError, classifyFailure } from './errors.js';
import { logEvent } from './logging.js';
import type { AuditBudgets, AuditJob, NetworkPolicy, RunnerPersistencePort } from './ports.js';

export interface RunnerPorts {
  readonly browserProvider: BrowserProvider;
  readonly persistence: RunnerPersistencePort;
  readonly budgets: AuditBudgets;
  readonly networkPolicy?: NetworkPolicy;
}

export type ExecuteAuditJobOutcome = 'completed' | 'failed' | 'skipped';

/**
 * Runs exactly one audit job to completion: claim → running → open browser
 * → `@ally/audit-runner` → persisting → complete, or fail at any step.
 *
 * This is the one place that knows how a hosted job is executed. The hosted
 * runner and local dev call it with different `RunnerPersistencePort`/
 * `BrowserProvider` implementations, never with different logic — there is
 * no separate "local" or "cloud" audit engine.
 */
export async function executeAuditJob(
  job: AuditJob,
  ports: RunnerPorts,
): Promise<ExecuteAuditJobOutcome> {
  const claim = await ports.persistence.claim(job);
  if (claim === 'terminal') {
    logEvent('info', 'job_already_terminal', { auditId: job.id, attempt: job.attempt });
    return 'skipped';
  }
  logEvent('info', 'job_claimed', { auditId: job.id, attempt: job.attempt });

  try {
    assertSyntacticallyPublicUrl(job.url, {
      ...(ports.networkPolicy?.allowHostnames === undefined
        ? {}
        : { allowHostnames: ports.networkPolicy.allowHostnames }),
    });
  } catch (error) {
    return fail(job, ports, error);
  }

  await ports.persistence.markRunning(job);
  logEvent('info', 'browser_creating', { auditId: job.id, attempt: job.attempt });

  const hooks: AuditHooks = {
    onStage: (event) => {
      logEvent(event.status === 'failed' ? 'warn' : 'info', `stage_${event.status}`, {
        auditId: job.id,
        attempt: job.attempt,
        stage: event.stage,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      });

      ports.persistence.reportStage(job, event).catch((reportError: unknown) => {
        logEvent('warn', 'stage_report_failed', {
          auditId: job.id,
          attempt: job.attempt,
          stage: event.stage,
          error: reportError instanceof Error ? reportError.message : String(reportError),
        });
      });
    },
  };

  try {
    const run = await withTimeout(
      ports.browserProvider.open(
        {
          url: job.url,
          navigationTimeoutMs: ports.budgets.navigationTimeoutMs,
          maxRedirects: ports.budgets.maxRedirects,
          ...(ports.networkPolicy?.allowHostnames === undefined
            ? {}
            : { allowHostnames: ports.networkPolicy.allowHostnames }),
        },
        (page) =>
          auditPage({
            url: job.url,
            page,
            only: job.options?.only ?? [],
            keyboard: job.options?.keyboard ?? true,
            hooks,
          }).then((outcome) => outcome.run),
      ),
      ports.budgets.auditTimeoutMs,
    );

    logEvent('info', 'navigation_completed', { auditId: job.id, attempt: job.attempt });

    await ports.persistence.markPersisting(job);
    await ports.persistence.complete(job, run);
    logEvent('info', 'audit_completed', { auditId: job.id, attempt: job.attempt });
    return 'completed';
  } catch (error) {
    return fail(job, ports, error);
  }
}

async function fail(
  job: AuditJob,
  ports: RunnerPorts,
  error: unknown,
): Promise<ExecuteAuditJobOutcome> {
  const { category, publicMessage } = classifyFailure(error);
  logEvent('error', 'audit_failed', {
    auditId: job.id,
    attempt: job.attempt,
    category,
    error: error instanceof Error ? error.message : String(error),
  });
  await ports.persistence.fail(job, category, publicMessage);
  return 'failed';
}

/**
 * Bounds the whole job. A fired timeout reports failure promptly; the
 * underlying browser operation is not force-cancelled (Node has no primitive
 * for that here) and releases its own resources shortly after via
 * `@ally/browser`'s existing `finally`-guaranteed cleanup, bounded in
 * practice by the navigation timeout that is always smaller than this one.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new AuditTimeoutError(`Audit exceeded its ${String(timeoutMs)}ms time budget.`),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        // Forwarded verbatim (not wrapped) so `classifyFailure`'s `instanceof`
        // checks on the original error (SsrfBlockedError, BrowserError, ...)
        // keep working.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        rejectPromise(error);
      },
    );
  });
}

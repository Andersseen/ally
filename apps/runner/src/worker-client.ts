import type { AuditRun, AuditStageEvent } from '@ally/core';
import type {
  AuditJob,
  ClaimResult,
  FailureCategory,
  RunnerPersistencePort,
} from '@ally/runner-core';

export interface WorkerClientConfig {
  readonly baseUrl: string;
  readonly secret: string;
  readonly runnerId: string;
}

/**
 * The runner's only way to change hosted audit state: authenticated calls
 * to the Worker's `/api/runner/*` surface. The runner holds no D1/R2
 * bindings itself — the Worker remains the sole owner of persistence, which
 * is what keeps this an execution plane rather than a second control plane.
 */
export function createWorkerPersistence(config: WorkerClientConfig): RunnerPersistencePort {
  const call = async (
    id: string,
    action: string,
    body: unknown,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`${config.baseUrl}/api/runner/audits/${id}/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Runner API "${action}" failed for ${id} with HTTP ${String(response.status)}.`,
      );
    }

    const parsed: unknown = await response.json().catch(() => ({}));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  };

  return {
    async claim(job: AuditJob): Promise<ClaimResult> {
      const result = await call(job.id, 'claim', { runnerId: config.runnerId });
      return result.terminal === true ? 'terminal' : 'claimed';
    },

    async markRunning(job: AuditJob): Promise<void> {
      await call(job.id, 'running', {});
    },

    async reportStage(job: AuditJob, event: AuditStageEvent): Promise<void> {
      await call(job.id, 'stage', {
        stage: event.stage,
        status: event.status,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      });
    },

    async markPersisting(job: AuditJob): Promise<void> {
      await call(job.id, 'persisting', {});
    },

    async complete(job: AuditJob, run: AuditRun): Promise<void> {
      await call(job.id, 'complete', {
        result: run.result,
        raw: Object.fromEntries(run.raw.entries()),
      });
    },

    async fail(job: AuditJob, category: FailureCategory, message: string): Promise<void> {
      await call(job.id, 'fail', { category, message });
    },
  };
}

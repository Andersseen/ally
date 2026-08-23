import type { AuditRun, AuditStageEvent } from '@ally/core';
import type { FailureCategory } from './errors.js';

export interface AuditJob {
  readonly id: string;
  readonly url: string;
  /** 1 on the first execution attempt, incremented on every re-claim. */
  readonly attempt: number;
  readonly options?: {
    readonly only?: readonly string[];
    readonly keyboard?: boolean;
    readonly recommendations?: boolean;
    readonly markupValidation?: boolean;
  };
}

export interface AuditBudgets {
  readonly navigationTimeoutMs: number;
  /** Bounds the whole job: browser open through artifact-ready. */
  readonly auditTimeoutMs: number;
  readonly maxRedirects: number;
}

export interface NetworkPolicy {
  /**
   * Exact `host` values (hostname, or `hostname:port`) exempted from the
   * SSRF private-network check. Empty/unset by default. Exists for a
   * deliberately configured exception — an operator's own internal target,
   * or (in tests) a local fixture server — never as a general bypass.
   */
  readonly allowHostnames?: ReadonlySet<string>;
}

/**
 * `'claimed'` — this attempt owns the job and should run it.
 * `'terminal'` — the job already reached a terminal state (a previous
 * attempt finished first, most likely from at-least-once queue redelivery).
 * The caller should acknowledge the transport message and do nothing else.
 */
export type ClaimResult = 'claimed' | 'terminal';

/**
 * Everything `executeAuditJob` needs to turn into state changes. One
 * implementation talks to the Worker's `/api/runner/*` HTTP surface (the
 * hosted runner); another mutates an in-memory map (local dev). Neither
 * implementation knows anything about engines or accessibility semantics —
 * that stays entirely inside `@ally/audit-runner`.
 */
export interface RunnerPersistencePort {
  claim(job: AuditJob): Promise<ClaimResult>;
  markRunning(job: AuditJob): Promise<void>;
  reportStage(job: AuditJob, event: AuditStageEvent): Promise<void>;
  markPersisting(job: AuditJob): Promise<void>;
  complete(job: AuditJob, run: AuditRun): Promise<void>;
  fail(job: AuditJob, category: FailureCategory, message: string): Promise<void>;
}

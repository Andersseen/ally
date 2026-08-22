import type { EngineFailure } from './audit.js';

/** An engine id, or `'keyboard'` for the keyboard analyzer. */
export type AuditStage = string;

/**
 * One moment in an audit's execution: a stage started, finished, or failed.
 *
 * Generic on purpose — `@ally/core` fires these around each engine and the
 * keyboard analyzer without knowing or caring who is listening. A CLI can
 * print them, a hosted runner can persist them as progress; this module
 * stays ignorant of both.
 */
export interface AuditStageEvent {
  readonly stage: AuditStage;
  readonly status: 'started' | 'ok' | 'failed';
  readonly durationMs?: number;
  readonly error?: EngineFailure;
}

export interface AuditHooks {
  readonly onStage?: (event: AuditStageEvent) => void;
}

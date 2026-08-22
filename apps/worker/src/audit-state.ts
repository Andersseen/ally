/**
 * The hosted audit job lifecycle.
 *
 * Kept intentionally small — every state here is something the dashboard can
 * usefully show. `claimed`/`persisting` exist because the task requires the
 * lifecycle to be explicit and debuggable, not because the UI needs to
 * distinguish them from `running`.
 */
export type AuditStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'persisting'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type AuditTransitionEvent =
  'claim' | 'start' | 'persist' | 'complete' | 'fail' | 'timeout' | 'cancel';

const TERMINAL_STATUSES: ReadonlySet<AuditStatus> = new Set([
  'completed',
  'failed',
  'timed_out',
  'cancelled',
]);

export function isTerminalStatus(status: AuditStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * States from which each event is a legal transition. `claim` accepts
 * `queued`, `claimed`, and `running` on purpose: at-least-once queue
 * redelivery means a second runner can legitimately try to claim a job a
 * first runner already started (or a first runner's lease can expire and
 * come back around) — that must succeed, not be treated as corruption.
 */
const ALLOWED_FROM: Readonly<Record<AuditTransitionEvent, ReadonlySet<AuditStatus>>> = {
  claim: new Set(['queued', 'claimed', 'running']),
  start: new Set(['claimed']),
  persist: new Set(['running']),
  complete: new Set(['persisting']),
  fail: new Set(['claimed', 'running', 'persisting']),
  timeout: new Set(['claimed', 'running', 'persisting']),
  cancel: new Set(['queued', 'claimed', 'running']),
};

const RESULT_OF: Readonly<Record<AuditTransitionEvent, AuditStatus>> = {
  claim: 'claimed',
  start: 'running',
  persist: 'persisting',
  complete: 'completed',
  fail: 'failed',
  timeout: 'timed_out',
  cancel: 'cancelled',
};

/**
 * Validates and computes a state transition. Returns `null` for an event
 * that is not legal from `current` — callers must not fall back to writing
 * an arbitrary status string when that happens.
 */
export function nextState(current: AuditStatus, event: AuditTransitionEvent): AuditStatus | null {
  return ALLOWED_FROM[event].has(current) ? RESULT_OF[event] : null;
}

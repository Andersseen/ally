import type { AuditListItem, HostedAuditStatus } from '../../core/api/ally-api.types';

export type StatusGroup = 'queued' | 'running' | 'completed' | 'failed';

export function stepGroup(status: HostedAuditStatus): StatusGroup {
  if (status === 'claimed') return 'queued';
  if (status === 'persisting') return 'running';
  if (status === 'cancelled' || status === 'timed_out') return 'failed';
  return status;
}

export function isTerminalStatus(status: HostedAuditStatus): boolean {
  return status === 'completed' || stepGroup(status) === 'failed';
}

export function statusTitleFor(status: StatusGroup): string {
  if (status === 'queued') return 'Audit queued';
  if (status === 'running') return 'Audit running';
  if (status === 'completed') return 'Audit complete';
  return 'Audit failed';
}

export function humanizeStage(currentStage: string | null | undefined): string {
  if (currentStage === null || currentStage === undefined || currentStage === '') return '';
  const [stage, status] = currentStage.split(':');
  if (stage === undefined) return '';

  const label =
    stage === 'keyboard' ? 'Keyboard analysis' : stage === 'container' ? 'Runner container' : stage;
  if (status === 'started') return `Running ${label}...`;
  if (status === 'failed') return `${label} failed, continuing.`;
  return `Completed ${label}`;
}

export function pollMessage(
  status: HostedAuditStatus,
  attempt: number,
  currentStage: string | null | undefined,
  lastError: string | null | undefined,
): string {
  if (status === 'failed') return lastError ?? 'The audit failed.';
  if (status === 'cancelled') return 'Audit cancelled.';
  if (status === 'timed_out') return 'Audit timed out.';
  if (status === 'completed') return 'Audit complete.';
  if (stepGroup(status) === 'queued') {
    if (currentStage?.startsWith('container:') === true) {
      return 'Runner container is starting. First runs can take a few minutes.';
    }
    return attempt >= 15
      ? 'Still queued - no runner has picked this up yet. Confirm a runner is deployed and processing the queue.'
      : 'Queued. Waiting for a runner to pick it up.';
  }
  return 'Audit is running.';
}

export function auditDateLabel(audit: AuditListItem): string {
  const date = audit.completedAt ?? audit.startedAt ?? audit.updatedAt ?? audit.createdAt;
  const prefix =
    audit.completedAt !== null && audit.completedAt !== undefined
      ? 'Completed'
      : audit.startedAt !== null && audit.startedAt !== undefined
        ? 'Started'
        : 'Created';
  return `${prefix} ${formatDate(date)}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

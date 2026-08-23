import './design-system';

const form = document.querySelector('#audit-form');
const input = document.querySelector('#audit-url');
const auditLockMessage = document.querySelector('#audit-lock-message');
const statusPanel = document.querySelector('#status-panel');
const keyboardOption = document.querySelector('#option-keyboard');
const recommendationsOption = document.querySelector('#option-recommendations');
const markupOption = document.querySelector('#option-markup');
const message = document.querySelector('#status-message');
const stageMessage = document.querySelector('#stage-message');
const stopButton = document.querySelector<HTMLElement & { disabled?: boolean }>('#stop-button');
const reportLink = document.querySelector('#report-link');
const targetPanel = document.querySelector('#target-panel');
const button = document.querySelector<HTMLElement & { disabled?: boolean; loading?: boolean }>(
  '#run-button',
);
const steps = Array.from(document.querySelectorAll('[data-step]'));
const recentAuditsEmpty = document.querySelector('#recent-audits-empty');
const recentAuditsList = document.querySelector('#recent-audits-list');

const apiBase = form?.getAttribute('data-api-base') ?? '';
let isAuthenticated = false;
/** The audit the status panel and stop button currently track, if any. */
let activeAuditId: string | null = null;

/**
 * The backend's full lifecycle. The UI groups these onto four visible
 * steps — `claimed` reads as `queued`, `persisting` as `running`, and
 * `cancelled`/`timed_out` as `failed` — see `stepGroup`.
 */
type HostedAuditStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'persisting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

type AuthSession = {
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly missingConfiguration?: readonly string[];
  readonly user?: {
    readonly email: string;
    readonly name: string;
  };
  readonly provider?: {
    readonly issuer: string;
    readonly clientId: string;
  };
};

interface AuditListItem {
  readonly id: string;
  readonly url: string;
  readonly status: HostedAuditStatus;
  readonly summary?: { readonly score: number | null };
}

async function refreshAuth(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/auth/session`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not read identity status.');
    const session = (await response.json()) as AuthSession;

    if (session.configured && session.authenticated) {
      setAuditAccess(true);
      void loadRecentAudits();
      return;
    }

    setAuditAccess(false);
    redirectToAuth();
  } catch {
    setAuditAccess(false);
    redirectToAuth();
  }
}

function setAuditAccess(canAudit: boolean): void {
  isAuthenticated = canAudit;
  if (input instanceof HTMLInputElement) input.disabled = !canAudit;
  if (button) button.disabled = !canAudit;
  targetPanel?.setAttribute('data-locked', String(!canAudit));
  targetPanel?.setAttribute('aria-disabled', String(!canAudit));
  if (auditLockMessage) {
    auditLockMessage.textContent = canAudit
      ? 'Your session is active. This audit will be billed to the protected Cloudflare project.'
      : 'Sign in to unlock hosted audits.';
  }
}

function setStatus(status: HostedAuditStatus, text: string): void {
  statusPanel?.classList.remove('hidden');
  if (message) message.textContent = text;
  stopButton?.classList.toggle('hidden', isTerminalStatus(status));

  const group = stepGroup(status);
  for (const step of steps) {
    const name = step.getAttribute('data-step');
    const active =
      group === name || (status === 'completed' && (name === 'queued' || name === 'running'));
    const failedStep = group === 'failed' && name === 'failed';

    step.classList.toggle('hidden', name === 'failed' && group !== 'failed');
    step.classList.toggle('flex', name !== 'failed' || group === 'failed');
    step.classList.toggle('font-semibold', active || failedStep);
    step.setAttribute('data-state', failedStep ? 'failed' : active ? 'active' : 'idle');
  }
}

/**
 * `claimed` reads as still-queued; `persisting` as still-running;
 * `cancelled`/`timed_out` share the `failed` step — the UI only has four.
 */
function stepGroup(status: HostedAuditStatus): 'queued' | 'running' | 'completed' | 'failed' {
  if (status === 'claimed') return 'queued';
  if (status === 'persisting') return 'running';
  if (status === 'cancelled' || status === 'timed_out') return 'failed';
  return status;
}

function isTerminalStatus(status: HostedAuditStatus): boolean {
  return status === 'completed' || stepGroup(status) === 'failed';
}

/**
 * Turns the backend's `"<stage>:<started|ok|failed>"` marker into short
 * human text. This is real progress read from `GET /api/audits/:id` — never
 * a simulated percentage.
 */
function humanizeStage(currentStage: string | null | undefined): string {
  if (currentStage === null || currentStage === undefined || currentStage === '') return '';
  const [stage, status] = currentStage.split(':');
  if (stage === undefined) return '';

  const label = stage === 'keyboard' ? 'Keyboard analysis' : stage;
  if (status === 'started') return `Running ${label}…`;
  if (status === 'failed') return `${label} failed, continuing.`;
  return `✓ ${label}`;
}

/** After this many 2s polls still queued, a runner is probably not deployed. */
const STALE_QUEUE_POLLS = 15;

async function poll(id: string, attempt = 0): Promise<void> {
  activeAuditId = id;
  const response = await fetch(`${apiBase}/api/audits/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not read audit status.');
  const audit = (await response.json()) as {
    readonly status: HostedAuditStatus;
    readonly currentStage?: string | null;
    readonly lastError?: string | null;
  };

  if (stageMessage) stageMessage.textContent = humanizeStage(audit.currentStage);
  setStatus(audit.status, pollMessage(audit.status, attempt, audit.lastError));

  if (audit.status === 'completed' && reportLink instanceof HTMLElement) {
    reportLink.setAttribute('href', `/reports?id=${encodeURIComponent(id)}`);
    reportLink.classList.remove('hidden');
    reportLink.classList.add('inline-flex');
  }

  if (isTerminalStatus(audit.status)) {
    activeAuditId = null;
    setButtonBusy(false);
    void loadRecentAudits();
    return;
  }

  window.setTimeout(() => void poll(id, attempt + 1).catch(showError), 2000);
}

function pollMessage(
  status: HostedAuditStatus,
  attempt: number,
  lastError: string | null | undefined,
): string {
  if (status === 'failed') return lastError ?? 'The audit failed.';
  if (status === 'cancelled') return 'Audit cancelled.';
  if (status === 'timed_out') return 'Audit timed out.';
  if (status === 'completed') return 'Audit complete.';
  if (stepGroup(status) === 'queued') {
    return attempt >= STALE_QUEUE_POLLS
      ? 'Still queued — no runner has picked this up yet. Confirm a runner is deployed and processing the queue.'
      : 'Queued. Waiting for a runner to pick it up.';
  }
  return 'Audit is running.';
}

function showError(error: unknown): void {
  setStatus('running', error instanceof Error ? error.message : String(error));
  setButtonBusy(false);
}

function setButtonBusy(isBusy: boolean): void {
  if (button) {
    button.disabled = isBusy;
    button.loading = isBusy;
  }
}

function redirectToAuth(): void {
  window.location.replace('/');
}

async function loadRecentAudits(): Promise<void> {
  if (recentAuditsList === null || recentAuditsEmpty === null) return;

  try {
    const response = await fetch(`${apiBase}/api/audits`, { credentials: 'include' });
    if (!response.ok) return;
    const body = (await response.json()) as { readonly audits: readonly AuditListItem[] };
    renderRecentAudits(body.audits);
  } catch {
    // The dashboard still works without this list; leave the empty state.
  }
}

function renderRecentAudits(audits: readonly AuditListItem[]): void {
  if (recentAuditsList === null || recentAuditsEmpty === null) return;

  if (audits.length === 0) {
    recentAuditsEmpty.classList.remove('hidden');
    recentAuditsList.classList.add('hidden');
    recentAuditsList.innerHTML = '';
    return;
  }

  recentAuditsEmpty.classList.add('hidden');
  recentAuditsList.classList.remove('hidden');
  recentAuditsList.innerHTML = audits.map(recentAuditRow).join('');
}

function recentAuditRow(audit: AuditListItem): string {
  const score =
    audit.status === 'completed' && audit.summary?.score !== null
      ? String(audit.summary?.score ?? '')
      : '—';
  const isDone = audit.status === 'completed';
  const isTerminal = isTerminalStatus(audit.status);
  const badgeVariant = audit.status === 'failed' ? 'destructive' : isDone ? 'default' : 'secondary';
  const hostname = safeHostname(audit.url);

  const stopControl = isTerminal
    ? ''
    : `<and-button type="button" variant="ghost" size="sm" data-cancel-audit="${escapeHtml(audit.id)}">Stop</and-button>`;

  const row = `
    <div and-layout="horizontal align:center justify:between gap:sm">
      <span class="truncate font-medium">${escapeHtml(hostname)}</span>
      <span class="text-ally-muted tabular-nums">${escapeHtml(score)}</span>
      <and-badge variant="${badgeVariant}">${escapeHtml(audit.status)}</and-badge>
      ${stopControl}
    </div>
  `;

  return isDone
    ? `<a href="/reports?id=${encodeURIComponent(audit.id)}"><and-card padded="true">${row}</and-card></a>`
    : `<and-card padded="true">${row}</and-card>`;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!(input instanceof HTMLInputElement)) return;
  if (!isAuthenticated) {
    setStatus('failed', 'Sign in before running a hosted audit.');
    return;
  }
  setButtonBusy(true);
  if (reportLink) reportLink.classList.add('hidden');

  setStatus('queued', 'Creating audit job.');

  void fetch(`${apiBase}/api/audits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      url: input.value,
      options: {
        keyboard: keyboardOption instanceof HTMLInputElement ? keyboardOption.checked : true,
        recommendations:
          recommendationsOption instanceof HTMLInputElement ? recommendationsOption.checked : false,
        markupValidation: markupOption instanceof HTMLInputElement ? markupOption.checked : false,
      },
    }),
  })
    .then(async (response) => {
      const body = (await response.json()) as { readonly id?: string; readonly error?: string };
      if (!response.ok || body.id === undefined) {
        throw new Error(body.error ?? 'Could not create audit.');
      }
      activeAuditId = body.id;
      setStatus('queued', 'Audit queued.');
      return poll(body.id);
    })
    .catch(showError);
});

async function cancelAudit(id: string): Promise<void> {
  await fetch(`${apiBase}/api/audits/${id}/cancel`, { method: 'POST', credentials: 'include' });
}

stopButton?.addEventListener('click', () => {
  if (activeAuditId === null || stopButton.disabled === true) return;
  const id = activeAuditId;
  stopButton.disabled = true;
  void cancelAudit(id)
    .then(() => poll(id))
    .catch(showError)
    .finally(() => {
      stopButton.disabled = false;
    });
});

recentAuditsList?.addEventListener('click', (event) => {
  const target =
    event.target instanceof Element ? event.target.closest('[data-cancel-audit]') : null;
  const id = target?.getAttribute('data-cancel-audit');
  if (id === null || id === undefined) return;

  void cancelAudit(id).finally(() => {
    void loadRecentAudits();
    if (id === activeAuditId) void poll(id).catch(showError);
  });
});

void refreshAuth();

export {};

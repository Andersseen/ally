import './design-system';

const form = document.querySelector('#audit-form');
const input = document.querySelector('#audit-url');
const auditLockMessage = document.querySelector('#audit-lock-message');
const authPanel = document.querySelector('#auth-panel');
const authStatus = document.querySelector('#auth-status');
const authLogin = document.querySelector<HTMLAnchorElement>('#auth-login');
const authLogout = document.querySelector<HTMLElement & { disabled?: boolean; loading?: boolean }>(
  '#auth-logout',
);
const statusPanel = document.querySelector('#status-panel');
const message = document.querySelector('#status-message');
const stageMessage = document.querySelector('#stage-message');
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

/** The four steps the UI shows. `claimed` groups with `queued`, `persisting` with `running`. */
type HostedAuditStatus = 'queued' | 'claimed' | 'running' | 'persisting' | 'completed' | 'failed';

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
  if (authPanel === null || authStatus === null) return;

  try {
    const response = await fetch(`${apiBase}/api/auth/session`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not read identity status.');
    const session = (await response.json()) as AuthSession;

    if (!session.configured) {
      authStatus.textContent = authConfigurationMessage(session.missingConfiguration);
      setAuditAccess(false);
      redirectToAuth();
      return;
    }

    if (session.authenticated) {
      authStatus.textContent = `Signed in as ${session.user?.email || session.user?.name || 'Ally user'}.`;
      setAuthActions(true, true);
      setAuditAccess(true);
      void loadRecentAudits();
      return;
    }

    authStatus.textContent = `Not signed in. Provider: ${session.provider?.issuer ?? 'dev-auth'}.`;
    setAuditAccess(false);
    redirectToAuth();
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : String(error);
    setAuditAccess(false);
    redirectToAuth();
  }
}

function authConfigurationMessage(missingConfiguration: readonly string[] = []): string {
  const missing =
    missingConfiguration.length > 0
      ? missingConfiguration.join(', ')
      : 'ALLY_SESSION_SECRET, DEV_AUTH_CLIENT_SECRET';
  return `dev-auth routes are ready. Set ${missing} in apps/worker/.dev.vars to enable local login.`;
}

function setAuthActions(isSignedIn: boolean, canLogin: boolean): void {
  authLogin?.classList.toggle('hidden', isSignedIn);
  authLogout?.classList.toggle('hidden', !isSignedIn);
  authLogin?.setAttribute('aria-disabled', String(!canLogin || isSignedIn));
  authLogin?.classList.toggle('is-disabled', !canLogin || isSignedIn);
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

  for (const step of steps) {
    const name = step.getAttribute('data-step');
    const failed = status === 'failed';
    const active =
      (!failed && stepGroup(status) === name) ||
      (!failed && status === 'completed' && (name === 'queued' || name === 'running'));
    const failedStep = failed && name === 'failed';

    step.classList.toggle('hidden', name === 'failed' && !failed);
    step.classList.toggle('flex', name !== 'failed' || failed);
    step.classList.toggle('font-semibold', active || failedStep);
    step.setAttribute('data-state', failedStep ? 'failed' : active ? 'active' : 'idle');
  }
}

/** `claimed` reads as still-queued to the user; `persisting` reads as still-running. */
function stepGroup(status: HostedAuditStatus): 'queued' | 'running' | 'completed' | 'failed' {
  if (status === 'claimed') return 'queued';
  if (status === 'persisting') return 'running';
  return status;
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

async function poll(id: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/audits/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not read audit status.');
  const audit = (await response.json()) as {
    readonly status: HostedAuditStatus;
    readonly currentStage?: string | null;
    readonly lastError?: string | null;
  };

  if (stageMessage) stageMessage.textContent = humanizeStage(audit.currentStage);

  if (audit.status === 'failed') {
    setStatus('failed', audit.lastError ?? 'The audit failed.');
    setButtonBusy(false);
    void loadRecentAudits();
    return;
  }

  setStatus(audit.status, audit.status === 'completed' ? 'Audit complete.' : 'Audit is running.');

  if (audit.status === 'completed') {
    if (reportLink instanceof HTMLElement) {
      reportLink.setAttribute('href', `/reports?id=${encodeURIComponent(id)}`);
      reportLink.classList.remove('hidden');
      reportLink.classList.add('inline-flex');
    }
    setButtonBusy(false);
    void loadRecentAudits();
    return;
  }

  window.setTimeout(() => void poll(id).catch(showError), 2000);
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
  const badgeVariant = audit.status === 'failed' ? 'destructive' : isDone ? 'default' : 'secondary';
  const hostname = safeHostname(audit.url);

  const row = `
    <div and-layout="horizontal align:center justify:between gap:sm">
      <span class="truncate font-medium">${escapeHtml(hostname)}</span>
      <span class="text-ally-muted tabular-nums">${escapeHtml(score)}</span>
      <and-badge variant="${badgeVariant}">${escapeHtml(audit.status)}</and-badge>
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
    body: JSON.stringify({ url: input.value }),
  })
    .then(async (response) => {
      const body = (await response.json()) as { readonly id?: string; readonly error?: string };
      if (!response.ok || body.id === undefined) {
        throw new Error(body.error ?? 'Could not create audit.');
      }
      setStatus('queued', 'Audit queued.');
      return poll(body.id);
    })
    .catch(showError);
});

authLogin?.addEventListener('click', (event) => {
  if (authLogin.getAttribute('aria-disabled') === 'true') event.preventDefault();
});

authLogout?.addEventListener('click', () => {
  authLogout.disabled = true;
  authLogout.loading = true;
  void fetch(`${apiBase}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(() => refreshAuth())
    .finally(() => {
      authLogout.disabled = false;
      authLogout.loading = false;
    });
});

void refreshAuth();

export {};

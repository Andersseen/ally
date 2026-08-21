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
const reportLink = document.querySelector('#report-link');
const targetPanel = document.querySelector('#target-panel');
const button = document.querySelector<HTMLElement & { disabled?: boolean; loading?: boolean }>(
  '#run-button',
);
const steps = Array.from(document.querySelectorAll('[data-step]'));

const apiBase = form?.getAttribute('data-api-base') ?? '';
let isAuthenticated = false;
type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
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
  const missing = missingConfiguration.length > 0
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

function setStatus(status: AuditStatus, text: string): void {
  statusPanel?.classList.remove('hidden');
  if (message) message.textContent = text;

  for (const step of steps) {
    const name = step.getAttribute('data-step');
    const failed = status === 'failed';
    const active =
      (!failed && status === name) ||
      (!failed && status === 'running' && name === 'queued') ||
      (!failed && status === 'completed' && (name === 'queued' || name === 'running'));
    const failedStep = failed && name === 'failed';

    step.classList.toggle('hidden', name === 'failed' && !failed);
    step.classList.toggle('flex', name !== 'failed' || failed);
    step.classList.toggle('font-semibold', active || failedStep);
    step.setAttribute('data-state', failedStep ? 'failed' : active ? 'active' : 'idle');
  }
}

async function poll(id: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/audits/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not read audit status.');
  const audit = (await response.json()) as {
    readonly status: AuditStatus;
    readonly error?: string;
  };

  if (audit.status === 'failed') {
    setStatus('failed', audit.error ?? 'The audit failed.');
    setButtonBusy(false);
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

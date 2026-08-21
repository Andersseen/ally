import './design-system';

const gate = document.querySelector('#auth-gate');
const authStatus = document.querySelector('#auth-status');
const authLogin = document.querySelector<HTMLAnchorElement>('#auth-login');
const dashboardLink = document.querySelector('#dashboard-link');
const authLogout = document.querySelector<HTMLElement & { disabled?: boolean; loading?: boolean }>(
  '#auth-logout',
);

const apiBase = gate?.getAttribute('data-api-base') ?? '';

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
  };
};

async function refreshAuth(): Promise<void> {
  if (authStatus === null) return;

  try {
    const response = await fetch(`${apiBase}/api/auth/session`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not read identity status.');
    const session = (await response.json()) as AuthSession;

    if (!session.configured) {
      authStatus.textContent = authConfigurationMessage(session.missingConfiguration);
      setSignedOut(false);
      return;
    }

    if (session.authenticated) {
      authStatus.textContent = `Signed in as ${session.user?.email || session.user?.name || 'Ally user'}.`;
      setSignedIn();
      return;
    }

    authStatus.textContent = `Not signed in. Provider: ${session.provider?.issuer ?? 'dev-auth'}.`;
    setSignedOut(true);
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : String(error);
    setSignedOut(false);
  }
}

function authConfigurationMessage(missingConfiguration: readonly string[] = []): string {
  const missing = missingConfiguration.length > 0
    ? missingConfiguration.join(', ')
    : 'ALLY_SESSION_SECRET, DEV_AUTH_CLIENT_SECRET';
  return `Local auth is not configured. Copy apps/worker/.dev.vars.example to apps/worker/.dev.vars and set: ${missing}.`;
}

function setSignedIn(): void {
  authLogin?.classList.add('hidden');
  dashboardLink?.classList.remove('hidden');
  authLogout?.classList.remove('hidden');
}

function setSignedOut(canLogin: boolean): void {
  dashboardLink?.classList.add('hidden');
  authLogout?.classList.add('hidden');
  authLogin?.classList.remove('hidden');
  authLogin?.setAttribute('aria-disabled', String(!canLogin));
  authLogin?.classList.toggle('is-disabled', !canLogin);
}

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

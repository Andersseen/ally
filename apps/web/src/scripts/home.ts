import './design-system';

const form = document.querySelector('#audit-form');
const input = document.querySelector('#audit-url');
const statusPanel = document.querySelector('#status-panel');
const message = document.querySelector('#status-message');
const reportLink = document.querySelector('#report-link');
const button = document.querySelector<HTMLElement & { disabled?: boolean; loading?: boolean }>(
  '#run-button',
);
const steps = Array.from(document.querySelectorAll('[data-step]'));

const apiBase = form?.getAttribute('data-api-base') ?? '';
type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

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
  const response = await fetch(`${apiBase}/api/audits/${id}`);
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

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!(input instanceof HTMLInputElement)) return;
  setButtonBusy(true);
  if (reportLink) reportLink.classList.add('hidden');

  setStatus('queued', 'Creating audit job.');

  void fetch(`${apiBase}/api/audits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

export {};

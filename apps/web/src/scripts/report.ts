import './design-system';

const root = document.querySelector('#report');
const apiBase = root?.getAttribute('data-api-base') ?? '';
const id = new URL(window.location.href).searchParams.get('id') ?? '';

interface AuditResultJson {
  readonly target: { readonly url: string };
  readonly finishedAt: string;
  readonly score: { readonly value: number };
  readonly summary: { readonly uniqueFindings: number };
  readonly coverage: {
    readonly enginesSucceeded: number;
    readonly enginesConfigured: number;
    readonly keyboardAnalysis: string;
  };
  readonly engines?: readonly {
    readonly status: 'ok' | 'failed';
    readonly engine: { readonly name: string };
    readonly findingCount?: number;
    readonly error?: { readonly message: string };
  }[];
  readonly findings?: readonly {
    readonly severity: string;
    readonly engineIds: readonly string[];
    readonly title: string;
    readonly description: string;
    readonly target?: { readonly path?: string };
  }[];
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(result: AuditResultJson): void {
  const findings = result.findings ?? [];
  const engines = result.engines ?? [];

  if (root) {
    root.innerHTML = `
      <p class="eyebrow">
        Automated accessibility audit
      </p>
      <h1 class="text-ally-ink break-words text-3xl font-bold">${escapeHtml(result.target.url)}</h1>
      <p class="text-ally-muted mt-3 text-sm">
        Audited ${escapeHtml(new Date(result.finishedAt).toUTCString())}
      </p>

      <div class="report-grid mt-6" and-motion="fade-in-up" and-motion-trigger="enter">
        ${renderMetric('Score', `${escapeHtml(result.score.value)} / 100`, 'activity')}
        ${renderMetric('Unique findings', result.summary.uniqueFindings, 'file-text')}
        ${renderMetric('Engines', `${escapeHtml(result.coverage.enginesSucceeded)} / ${escapeHtml(result.coverage.enginesConfigured)}`, 'success')}
        ${renderMetric('Keyboard', result.coverage.keyboardAnalysis, 'accessibility')}
      </div>

      <and-alert class="mt-6 block" variant="default">
        <and-icon slot="icon" name="info"></and-icon>
        Automated testing only. This report does not establish WCAG conformance, and manual review is still required.
      </and-alert>

      <section class="mt-8">
        <h2 class="text-ally-ink text-xl font-bold">Engine runs</h2>
        <and-card class="mt-3 block" padded="true">
          ${engines
            .map(
              (run) => `
                <article class="engine-row py-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <h3 class="text-ally-ink font-semibold">${escapeHtml(run.engine.name)}</h3>
                    <and-badge variant="${run.status === 'ok' ? 'default' : 'destructive'}">${escapeHtml(run.status)}</and-badge>
                  </div>
                  <p class="text-ally-muted mt-2 text-sm">
                    ${
                      run.status === 'ok'
                        ? `${escapeHtml(run.findingCount)} normalized findings`
                        : escapeHtml(run.error?.message ?? 'The engine failed.')
                    }
                  </p>
                </article>
              `,
            )
            .join('')}
        </and-card>
      </section>

      <section class="mt-8">
        <h2 class="text-ally-ink text-xl font-bold">Findings</h2>
        <div class="mt-3 space-y-3" and-motion="fade-in-up" and-motion-trigger="enter">
          ${
            findings.length === 0
              ? '<and-card padded="true"><p class="text-ally-muted">No automated findings were reported.</p></and-card>'
              : findings
                  .map(
                    (finding) => `
                      <and-card class="block" padded="true">
                      <article>
                        <div class="flex flex-wrap items-center gap-2">
                          <and-badge variant="secondary">${escapeHtml(finding.severity)}</and-badge>
                          <and-badge variant="outline">${escapeHtml(finding.engineIds.join(', '))}</and-badge>
                        </div>
                        <h3 class="text-ally-ink mt-3 font-semibold">${escapeHtml(finding.title)}</h3>
                        <p class="mt-2 text-sm leading-6 text-[#38443f]">${escapeHtml(finding.description)}</p>
                        ${
                          finding.target?.path
                            ? `<p class="text-ally-muted mt-2 break-all font-mono text-xs">${escapeHtml(finding.target.path)}</p>`
                            : ''
                        }
                      </article>
                      </and-card>
                    `,
                  )
                  .join('')
          }
        </div>
      </section>
    `;
  }
}

function renderMetric(label: string, value: unknown, icon: string): string {
  return `
    <and-card padded="true">
      <div and-layout="horizontal align:center justify:between gap:sm">
        <div>
          <p class="text-ally-muted text-sm">${escapeHtml(label)}</p>
          <p class="metric-value mt-2">${escapeHtml(value)}</p>
        </div>
        <span class="brand-icon" aria-hidden="true">
          <and-icon name="${escapeHtml(icon)}" size="18"></and-icon>
        </span>
      </div>
    </and-card>
  `;
}

if (id === '') {
  if (root) {
    root.innerHTML =
      '<and-alert variant="destructive"><and-icon slot="icon" name="alert-circle"></and-icon>Missing audit id.</and-alert>';
  }
} else {
  fetch(`${apiBase}/api/audits/${id}/result`, { credentials: 'include' })
    .then(async (response) => {
      if (response.status === 401) throw new Error('Sign in to view this audit report.');
      if (!response.ok) throw new Error('The report is not available yet.');
      return (await response.json()) as AuditResultJson;
    })
    .then(render)
    .catch((error: unknown) => {
      if (root) {
        root.innerHTML = `<and-alert variant="destructive"><and-icon slot="icon" name="alert-circle"></and-icon>${escapeHtml(error instanceof Error ? error.message : String(error))}</and-alert>`;
      }
    });
}

export {};

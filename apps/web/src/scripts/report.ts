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
      <p class="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#7c4f2b]">
        Automated accessibility audit
      </p>
      <h1 class="break-words text-3xl font-bold text-[#14211e]">${escapeHtml(result.target.url)}</h1>
      <p class="mt-3 text-sm text-[#5b675f]">
        Audited ${escapeHtml(new Date(result.finishedAt).toUTCString())}
      </p>

      <div class="mt-6 grid gap-4 sm:grid-cols-4">
        <div class="rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4">
          <p class="text-sm text-[#5b675f]">Score</p>
          <p class="mt-1 text-3xl font-bold text-[#14211e]">${escapeHtml(result.score.value)} / 100</p>
        </div>
        <div class="rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4">
          <p class="text-sm text-[#5b675f]">Unique findings</p>
          <p class="mt-1 text-3xl font-bold text-[#14211e]">${escapeHtml(result.summary.uniqueFindings)}</p>
        </div>
        <div class="rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4">
          <p class="text-sm text-[#5b675f]">Engines</p>
          <p class="mt-1 text-3xl font-bold text-[#14211e]">${escapeHtml(result.coverage.enginesSucceeded)} / ${escapeHtml(result.coverage.enginesConfigured)}</p>
        </div>
        <div class="rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4">
          <p class="text-sm text-[#5b675f]">Keyboard</p>
          <p class="mt-1 text-3xl font-bold text-[#14211e]">${escapeHtml(result.coverage.keyboardAnalysis)}</p>
        </div>
      </div>

      <p class="mt-6 rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4 text-sm leading-6 text-[#4d4439]">
        Automated testing only. This report does not establish WCAG conformance, and manual review is still required.
      </p>

      <section class="mt-8">
        <h2 class="text-xl font-bold text-[#14211e]">Engine runs</h2>
        <div class="mt-3 divide-y divide-[#d8c9b1] rounded-md border border-[#d8c9b1] bg-white">
          ${engines
            .map(
              (run) => `
                <article class="p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <h3 class="font-semibold text-[#14211e]">${escapeHtml(run.engine.name)}</h3>
                    <span class="text-sm ${run.status === 'ok' ? 'text-[#1d5d52]' : 'text-[#9a351f]'}">${escapeHtml(run.status)}</span>
                  </div>
                  <p class="mt-2 text-sm text-[#5b675f]">
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
        </div>
      </section>

      <section class="mt-8">
        <h2 class="text-xl font-bold text-[#14211e]">Findings</h2>
        <div class="mt-3 space-y-3">
          ${
            findings.length === 0
              ? '<p class="rounded-md border border-[#d8c9b1] bg-white p-4 text-[#5b675f]">No automated findings were reported.</p>'
              : findings
                  .map(
                    (finding) => `
                      <article class="rounded-md border border-[#d8c9b1] bg-white p-4">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="rounded-sm bg-[#f1e3cd] px-2 py-1 text-xs font-semibold uppercase text-[#7c4f2b]">${escapeHtml(finding.severity)}</span>
                          <span class="text-xs text-[#5b675f]">${escapeHtml(finding.engineIds.join(', '))}</span>
                        </div>
                        <h3 class="mt-3 font-semibold text-[#14211e]">${escapeHtml(finding.title)}</h3>
                        <p class="mt-2 text-sm leading-6 text-[#38443f]">${escapeHtml(finding.description)}</p>
                        ${
                          finding.target?.path
                            ? `<p class="mt-2 break-all font-mono text-xs text-[#5b675f]">${escapeHtml(finding.target.path)}</p>`
                            : ''
                        }
                      </article>
                    `,
                  )
                  .join('')
          }
        </div>
      </section>
    `;
  }
}

if (id === '') {
  if (root) root.innerHTML = '<p class="text-[#9a351f]">Missing audit id.</p>';
} else {
  fetch(`${apiBase}/api/audits/${id}/result`)
    .then(async (response) => {
      if (!response.ok) throw new Error('The report is not available yet.');
      return (await response.json()) as AuditResultJson;
    })
    .then(render)
    .catch((error: unknown) => {
      if (root) {
        root.innerHTML = `<p class="rounded-md border border-[#d8c9b1] bg-[#fffaf1] p-4 text-[#9a351f]">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
      }
    });
}

export {};

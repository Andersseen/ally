import './design-system';

const root = document.querySelector('#report');
const apiBase = root?.getAttribute('data-api-base') ?? '';
const id = new URL(window.location.href).searchParams.get('id') ?? '';

interface AuditResultJson {
  readonly target: { readonly url: string };
  readonly options?: {
    readonly recommendations?: boolean;
    readonly markupValidation?: boolean;
    readonly aiReview?: boolean;
  };
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
    readonly id: string;
    readonly severity: string;
    readonly engineIds: readonly string[];
    readonly title: string;
    readonly description?: string;
    readonly target?: {
      readonly label?: string;
      readonly path?: string;
      readonly selector?: string;
      readonly tagName?: string;
      readonly html?: string;
    };
  }[];
  readonly remediations?: Record<string, RemediationJson>;
  readonly aiReview?: AiReviewJson;
  readonly wcagReview?: {
    readonly standard: {
      readonly name: string;
      readonly version: string;
      readonly levels: readonly string[];
      readonly datasetRevision: string;
    };
    readonly criteria: readonly {
      readonly criterion: { readonly id: string; readonly title: string; readonly level: string };
      readonly statuses: readonly string[];
      readonly automatedFindingCount: number;
      readonly aiReviewCount: number;
      readonly manualReviewRequired: boolean;
    }[];
  };
}

interface AiReviewJson {
  readonly enabled: boolean;
  readonly model?: string;
  readonly status: 'disabled' | 'pending' | 'completed' | 'failed' | 'unavailable';
  readonly reviews: readonly {
    readonly status: 'pending' | 'reviewed' | 'failed' | 'skipped';
    readonly task: {
      readonly id: string;
      readonly criterion: string;
      readonly rule: {
        readonly title: string;
        readonly level: string;
        readonly reviewGoal: string;
      };
      readonly evidenceRefs: readonly string[];
    };
    readonly result?: {
      readonly outcome: string;
      readonly confidence: string;
      readonly summary: string;
      readonly suggestedReview?: string;
    };
    readonly error?: string;
  }[];
}

interface RemediationJson {
  readonly confidence: string;
  readonly summary: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly goodExample?: string;
  readonly badExample?: string;
  readonly references?: readonly {
    readonly label: string;
    readonly url: string;
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
  const remediations = result.remediations ?? {};
  const recommendationsRequested = result.options?.recommendations === true;
  const aiReviewRequested = result.options?.aiReview === true;
  const remediationCount = Object.keys(remediations).length;

  if (root) {
    root.innerHTML = `
      <p class="eyebrow">
        Automated accessibility audit
      </p>
      <h1 class="text-ally-ink break-words text-3xl font-bold">${escapeHtml(result.target.url)}</h1>
      <p class="text-ally-muted mt-3 text-sm">
        Audited ${escapeHtml(new Date(result.finishedAt).toUTCString())}
      </p>
      <p class="text-ally-muted mt-1 text-sm">
        Recommendations ${recommendationsRequested ? `enabled (${escapeHtml(remediationCount)} fixes)` : 'not requested'}${
          result.options?.markupValidation === true ? ' · Markup validation enabled' : ''
        }${aiReviewRequested ? ' · AI-assisted review enabled' : ''}
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

      ${renderWcagReview(result)}

      <section class="mt-8" aria-labelledby="engine-runs-heading">
        <h2 id="engine-runs-heading" class="text-ally-ink text-xl font-bold">Engine runs</h2>
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

      <section class="mt-8" aria-labelledby="findings-heading">
        <h2 id="findings-heading" class="text-ally-ink text-xl font-bold">Findings</h2>
        ${
          recommendationsRequested
            ? remediationCount === 0
              ? `<and-alert class="mt-3 block" variant="default"><and-icon slot="icon" name="info"></and-icon>No deterministic fix recommendations were available for this audit.</and-alert>`
              : ''
            : `<and-alert class="mt-3 block" variant="default"><and-icon slot="icon" name="info"></and-icon>Fix recommendations were not requested for this audit. Enable “Recommendations” before running the next audit to include them.</and-alert>`
        }
        <div class="mt-3" and-motion="fade-in-up" and-motion-trigger="enter">
          ${
            findings.length === 0
              ? '<and-card padded="true"><p class="text-ally-muted">No automated findings were reported.</p></and-card>'
              : `<ul class="space-y-3" role="list">${findings.map((finding) => renderFinding(finding, remediations[finding.id])).join('')}</ul>`
          }
        </div>
      </section>
    `;
  }
}

function renderWcagReview(result: AuditResultJson): string {
  const wcag = result.wcagReview;
  const ai = result.aiReview;
  if (wcag === undefined) return '';
  const counts = countWcagStatuses(wcag.criteria);
  const reviewed = ai?.reviews.filter((review) => review.status === 'reviewed') ?? [];
  const flagged = reviewed.filter((review) => review.result?.outcome === 'potential-issue');

  return `
    <section class="mt-8" aria-labelledby="wcag-review-heading">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="wcag-review-heading" class="text-ally-ink text-xl font-bold">WCAG 2.2 A/AA Review</h2>
          <p class="text-ally-muted mt-1 text-sm">Dataset ${escapeHtml(wcag.standard.datasetRevision)}</p>
        </div>
        <and-badge variant="${ai?.status === 'completed' ? 'default' : ai?.status === 'failed' || ai?.status === 'unavailable' ? 'destructive' : 'secondary'}">
          AI ${escapeHtml(ai?.status ?? 'disabled')}
        </and-badge>
      </div>
      <div class="report-grid mt-4">
        ${renderMetric('Review coverage', `${escapeHtml(counts.coveragePercent)}% (${escapeHtml(counts.covered)} / ${escapeHtml(wcag.criteria.length)})`, 'success')}
        ${renderMetric('Automatically checked', counts.automated, 'success')}
        ${renderMetric('Behaviorally checked', counts.behavioral, 'accessibility')}
        ${renderMetric('AI-assisted review', reviewed.length, 'activity')}
        ${renderMetric('Manual review required', counts.manual, 'file-text')}
      </div>
      ${
        ai?.status === 'unavailable'
          ? `<and-alert class="mt-4 block" variant="default"><and-icon slot="icon" name="info"></and-icon>AI-assisted review unavailable. Deterministic audit results are still complete.</and-alert>`
          : ''
      }
      <and-card class="mt-4 block" padded="true">
        <ul class="space-y-3" role="list">
          ${wcag.criteria
            .filter(
              (criterion) =>
                criterion.automatedFindingCount > 0 ||
                criterion.aiReviewCount > 0 ||
                criterion.statuses.includes('not-yet-covered'),
            )
            .slice(0, 12)
            .map((criterion) => renderCriterionRow(criterion, ai))
            .join('')}
        </ul>
      </and-card>
      ${
        flagged.length === 0
          ? ''
          : `<div class="mt-4 space-y-3">${flagged.map(renderAiReview).join('')}</div>`
      }
    </section>
  `;
}

function countWcagStatuses(criteria: NonNullable<AuditResultJson['wcagReview']>['criteria']) {
  const covered = criteria.filter(
    (criterion) =>
      criterion.statuses.includes('automated-checked') ||
      criterion.statuses.includes('behaviorally-checked') ||
      criterion.statuses.includes('ai-reviewed'),
  ).length;
  return {
    covered,
    coveragePercent: criteria.length === 0 ? 0 : Math.round((covered / criteria.length) * 100),
    automated: criteria.filter((criterion) => criterion.statuses.includes('automated-checked'))
      .length,
    behavioral: criteria.filter((criterion) => criterion.statuses.includes('behaviorally-checked'))
      .length,
    manual: criteria.filter((criterion) => criterion.manualReviewRequired).length,
  };
}

function renderCriterionRow(
  criterion: NonNullable<AuditResultJson['wcagReview']>['criteria'][number],
  ai: AiReviewJson | undefined,
): string {
  const review = ai?.reviews.find(
    (item) => item.status === 'reviewed' && item.task.criterion === criterion.criterion.id,
  );
  return `
    <li class="border-b border-[var(--ally-secondary-border)] pb-3 last:border-b-0 last:pb-0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-ally-ink text-sm font-semibold">
          ${escapeHtml(criterion.criterion.id)} ${escapeHtml(criterion.criterion.title)}
          <span class="text-ally-muted">Level ${escapeHtml(criterion.criterion.level)}</span>
        </h3>
        <and-badge variant="outline">${escapeHtml(review?.result?.outcome ?? criterion.statuses[0] ?? 'manual-review-required')}</and-badge>
      </div>
      <p class="text-ally-muted mt-1 text-sm">
        Automated evidence ${escapeHtml(criterion.automatedFindingCount)} · AI reviews ${escapeHtml(criterion.aiReviewCount)} · Human review ${criterion.manualReviewRequired ? 'recommended' : 'not expected'}
      </p>
    </li>
  `;
}

function renderAiReview(review: AiReviewJson['reviews'][number]): string {
  const result = review.result;
  if (result === undefined) return '';
  return `
    <and-card class="block" padded="true">
      <div class="flex flex-wrap items-center gap-2">
        <and-badge variant="${result.outcome === 'potential-issue' ? 'destructive' : 'secondary'}">${escapeHtml(result.outcome)}</and-badge>
        <and-badge variant="outline">Confidence ${escapeHtml(result.confidence)}</and-badge>
      </div>
      <h3 class="text-ally-ink mt-3 font-semibold">${escapeHtml(review.task.criterion)} ${escapeHtml(review.task.rule.title)}</h3>
      <p class="text-ally-muted mt-2 text-sm leading-6">${escapeHtml(result.summary)}</p>
      ${
        result.suggestedReview === undefined
          ? ''
          : `<p class="text-ally-muted mt-2 text-sm leading-6">${escapeHtml(result.suggestedReview)}</p>`
      }
    </and-card>
  `;
}

function renderFinding(
  finding: NonNullable<AuditResultJson['findings']>[number],
  remediation: RemediationJson | undefined,
): string {
  const elementLabel = targetLabel(finding.target);

  return `
    <li>
      <and-card class="block" padded="true">
        <article aria-labelledby="finding-${escapeHtml(finding.id)}">
          <div class="flex flex-wrap items-center gap-2">
            <and-badge variant="secondary">${escapeHtml(finding.severity)}</and-badge>
            <and-badge variant="outline">${escapeHtml(finding.engineIds.join(', '))}</and-badge>
          </div>
          <h3 id="finding-${escapeHtml(finding.id)}" class="text-ally-ink mt-3 font-semibold">${escapeHtml(finding.title)}</h3>
          ${
            finding.description === undefined || finding.description === ''
              ? ''
              : `<p class="text-ally-muted mt-2 text-sm leading-6">${escapeHtml(finding.description)}</p>`
          }
          ${
            elementLabel === ''
              ? ''
              : `<div class="mt-3 rounded-md border border-[var(--ally-secondary-border)] bg-[var(--ally-field-bg)] px-3 py-2">
                  <p class="text-xs font-semibold text-ally-muted">Affected element</p>
                  <p class="mt-1 break-words text-sm">${elementLabel}</p>
                </div>`
          }
          ${remediation === undefined ? '' : renderRemediation(remediation)}
        </article>
      </and-card>
    </li>
  `;
}

function targetLabel(target: NonNullable<AuditResultJson['findings']>[number]['target']): string {
  if (target === undefined) return '';

  const parts = [
    target.tagName === undefined
      ? ''
      : `<span class="font-mono text-xs">&lt;${escapeHtml(target.tagName)}&gt;</span>`,
    target.label === undefined || target.label === ''
      ? ''
      : `<span>${escapeHtml(target.label)}</span>`,
  ].filter(Boolean);

  const path = target.selector ?? target.path;
  if (path !== undefined && path !== '') {
    parts.push(
      `<span class="block break-all font-mono text-xs text-ally-muted">${escapeHtml(path)}</span>`,
    );
  }

  if (parts.length > 0) return parts.join(' ');
  return '<span class="text-ally-muted">No stable element label was reported.</span>';
}

function renderRemediation(remediation: RemediationJson): string {
  return `
    <section class="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-3" aria-label="Fix recommendation">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h4 class="text-sm font-semibold text-ally-ink">Fix recommendation</h4>
        <span class="text-xs font-semibold uppercase text-ally-muted">${escapeHtml(remediation.confidence)}</span>
      </div>
      <p class="mt-2 text-sm font-semibold">${escapeHtml(remediation.summary)}</p>
      <p class="mt-1 text-sm text-ally-muted">${escapeHtml(remediation.why)}</p>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
        ${remediation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
      </ol>
      ${
        remediation.goodExample === undefined && remediation.badExample === undefined
          ? ''
          : `<div class="mt-3 grid gap-2 md:grid-cols-2">
              ${renderCodeExample('Good example', remediation.goodExample)}
              ${renderCodeExample('Avoid', remediation.badExample)}
            </div>`
      }
      ${
        remediation.references === undefined || remediation.references.length === 0
          ? ''
          : `<ul class="mt-3 space-y-1" role="list">
              ${remediation.references
                .map(
                  (reference) =>
                    `<li class="text-xs"><a class="underline decoration-slate-400 underline-offset-2 hover:decoration-current" href="${escapeHtml(reference.url)}">${escapeHtml(reference.label)}</a></li>`,
                )
                .join('')}
            </ul>`
      }
    </section>
  `;
}

function renderCodeExample(label: string, value: string | undefined): string {
  if (value === undefined) return '';
  return `
    <div>
      <p class="text-xs font-semibold text-ally-muted">${escapeHtml(label)}</p>
      <pre class="mt-1 whitespace-pre-wrap break-all rounded border border-[var(--ally-secondary-border)] bg-[var(--ally-field-bg)] p-2 font-mono text-xs"><code>${escapeHtml(value)}</code></pre>
    </div>
  `;
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

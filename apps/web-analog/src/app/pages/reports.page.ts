import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { VoltBadge, VoltButton, VoltCard } from '@voltui/components';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnDocumentTextIcon } from 'lumen-icons/document-text';
import { LmnInformationCircleIcon } from 'lumen-icons/information-circle';
import { defineRouteMeta } from '@analogjs/router';
import { AllyApiService } from '../core/api/ally-api.service';
import type { AuditResultJson } from '../core/api/ally-api.types';
import { AppShellComponent } from '../shared/components/app-shell.component';
import { downloadBlob, reportFileBaseName, toMarkdown } from '../features/reports/report-export';

export const routeMeta = defineRouteMeta({ title: 'Ally report - Ally' });

@Component({
  imports: [
    AppShellComponent,
    VoltBadge,
    VoltButton,
    VoltCard,
    DatePipe,
    NgTemplateOutlet,
    LmnDocumentTextIcon,
    LmnInformationCircleIcon,
    ...MOVEMENT_DIRECTIVES,
  ],
  template: `
    <ally-app-shell badge="Automated audit report" [reportMode]="true">
      <section class="py-8" aria-live="polite">
        @if (loading()) {
          <volt-card>
            <p class="text-ally-muted p-5">Loading report...</p>
          </volt-card>
        } @else if (error(); as message) {
          <div
            class="rounded-lg border border-[var(--ally-danger)] bg-[var(--ally-secondary-bg)] p-4 text-sm font-semibold text-[var(--ally-danger)]"
            role="alert"
          >
            {{ message }}
          </div>
        } @else if (result(); as report) {
          <div [move]="'fade-up'">
            <p class="eyebrow">Automated accessibility audit</p>
            <h1 class="text-ally-ink break-words text-3xl font-bold">{{ report.target.url }}</h1>
            <p class="text-ally-muted mt-3 text-sm">
              Audited {{ report.finishedAt | date: 'medium' : 'UTC' }}
            </p>
            <p class="text-ally-muted mt-1 text-sm">
              Recommendations
              {{ report.options?.recommendations ? 'enabled' : 'not requested' }}
              @if (report.options?.markupValidation) {
                <span> · Markup validation enabled</span>
              }
              @if (report.options?.aiReview) {
                <span> · AI-assisted review enabled</span>
              }
            </p>

            <div class="mt-4 flex flex-wrap gap-2" data-print-hide>
              <volt-button variant="outline" size="sm" (click)="exportJson(report)">
                <lmn-document-text slot="leading" [size]="14" />
                Export JSON
              </volt-button>
              <volt-button variant="outline" size="sm" (click)="exportMarkdown(report)">
                <lmn-document-text slot="leading" [size]="14" />
                Export Markdown
              </volt-button>
              <volt-button variant="outline" size="sm" (click)="print()">
                <lmn-document-text slot="leading" [size]="14" />
                Export PDF
              </volt-button>
            </div>

            <div class="report-grid mt-6">
              <ng-container
                *ngTemplateOutlet="metric; context: { label: 'Score', value: score() }"
              />
              <ng-container
                *ngTemplateOutlet="
                  metric;
                  context: { label: 'Unique findings', value: report.summary.uniqueFindings }
                "
              />
              <ng-container
                *ngTemplateOutlet="
                  metric;
                  context: {
                    label: 'Engines',
                    value:
                      report.coverage.enginesSucceeded + ' / ' + report.coverage.enginesConfigured,
                  }
                "
              />
              <ng-container
                *ngTemplateOutlet="
                  metric;
                  context: { label: 'Keyboard', value: report.coverage.keyboardAnalysis }
                "
              />
            </div>

            <div
              class="mt-6 rounded-lg border border-[var(--ally-secondary-border)] bg-[var(--ally-secondary-bg)] p-4 text-sm text-[var(--ally-secondary-text)]"
              role="note"
            >
              <lmn-information-circle class="mr-2 inline-block align-text-bottom" [size]="16" />
              Automated testing only. This report does not establish WCAG conformance, and manual
              review is still required.
            </div>

            @if (report.wcagReview; as wcag) {
              <section class="mt-8" aria-labelledby="wcag-review-heading">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 id="wcag-review-heading" class="text-ally-ink text-xl font-bold">
                      WCAG {{ wcag.standard.version }} {{ wcag.standard.levels.join('/') }} Review
                    </h2>
                    <p class="text-ally-muted mt-1 text-sm">
                      Dataset {{ wcag.standard.datasetRevision }}
                    </p>
                  </div>
                  <volt-badge
                    [variant]="report.aiReview?.status === 'completed' ? 'solid' : 'secondary'"
                  >
                    AI {{ report.aiReview?.status ?? 'disabled' }}
                  </volt-badge>
                </div>
              </section>
            }

            <section class="mt-8" aria-labelledby="engine-runs-heading">
              <h2 id="engine-runs-heading" class="text-ally-ink text-xl font-bold">Engine runs</h2>
              <volt-card class="mt-3 block">
                <div class="divide-y divide-[var(--ally-faint)] p-5">
                  @for (run of report.engines ?? []; track run.engine.name) {
                    <article class="py-4 first:pt-0 last:pb-0">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <h3 class="text-ally-ink font-semibold">{{ run.engine.name }}</h3>
                        <volt-badge [variant]="run.status === 'ok' ? 'solid' : 'destructive'">{{
                          run.status
                        }}</volt-badge>
                      </div>
                      <p class="text-ally-muted mt-2 text-sm">
                        {{
                          run.status === 'ok'
                            ? (run.findingCount ?? 0) + ' normalized findings'
                            : (run.error?.message ?? 'The engine failed.')
                        }}
                      </p>
                    </article>
                  }
                </div>
              </volt-card>
            </section>

            <section class="mt-8" aria-labelledby="findings-heading">
              <h2 id="findings-heading" class="text-ally-ink text-xl font-bold">Findings</h2>
              @if ((report.findings ?? []).length === 0) {
                <volt-card class="mt-3 block"
                  ><p class="text-ally-muted p-5">
                    No automated findings were reported.
                  </p></volt-card
                >
              } @else {
                <ul class="mt-3 space-y-3" role="list">
                  @for (finding of report.findings ?? []; track finding.id) {
                    <li>
                      <volt-card>
                        <article class="p-5" [attr.aria-labelledby]="'finding-' + finding.id">
                          <div class="flex flex-wrap items-center gap-2">
                            <volt-badge variant="secondary">{{ finding.severity }}</volt-badge>
                            <volt-badge variant="outline">{{
                              finding.engineIds.join(', ')
                            }}</volt-badge>
                          </div>
                          <h3
                            [id]="'finding-' + finding.id"
                            class="text-ally-ink mt-3 font-semibold"
                          >
                            {{ finding.title }}
                          </h3>
                          @if (finding.description) {
                            <p class="text-ally-muted mt-2 text-sm leading-6">
                              {{ finding.description }}
                            </p>
                          }
                        </article>
                      </volt-card>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }
      </section>
    </ally-app-shell>

    <ng-template #metric let-label="label" let-value="value">
      <volt-card>
        <div class="p-5">
          <p class="text-ally-muted text-sm">{{ label }}</p>
          <p class="metric-value mt-2">{{ value }}</p>
        </div>
      </volt-card>
    </ng-template>
  `,
})
export default class ReportsPageComponent implements OnInit {
  private readonly api = inject(AllyApiService);
  private readonly route = inject(ActivatedRoute);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly result = signal<AuditResultJson | null>(null);
  readonly score = computed(() => `${this.result()?.score.value ?? 0} / 100`);

  ngOnInit(): void {
    void this.loadReport();
  }

  private async loadReport(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get('id') ?? '';
    if (id === '') {
      this.error.set('Missing audit id.');
      this.loading.set(false);
      return;
    }
    try {
      this.result.set(await this.api.result(id));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The report is not available yet.');
    } finally {
      this.loading.set(false);
    }
  }

  exportJson(result: AuditResultJson): void {
    downloadBlob(
      `${reportFileBaseName(result)}.json`,
      JSON.stringify(result, null, 2),
      'application/json',
    );
  }

  exportMarkdown(result: AuditResultJson): void {
    downloadBlob(`${reportFileBaseName(result)}.md`, toMarkdown(result), 'text/markdown');
  }

  print(): void {
    window.print();
  }
}

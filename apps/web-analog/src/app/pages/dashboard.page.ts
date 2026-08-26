import { Component, inject, signal, ViewChild } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { VoltBadge } from '@voltui/components';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnCheckCircleIcon } from 'lumen-icons/check-circle';
import { LmnDocumentTextIcon } from 'lumen-icons/document-text';
import { LmnInformationCircleIcon } from 'lumen-icons/information-circle';
import { LmnPresentationChartBarIcon } from 'lumen-icons/presentation-chart-bar';
import { defineRouteMeta } from '@analogjs/router';
import { AuthService } from '../core/auth/auth.service';
import { AppShellComponent } from '../shared/components/app-shell.component';
import { AuditFormComponent } from '../features/dashboard/audit-form.component';
import { AuditProgressComponent } from '../features/dashboard/audit-progress.component';
import { AuditStore } from '../features/dashboard/audit-store.service';
import { RecentAuditsComponent } from '../features/dashboard/recent-audits.component';

export const routeMeta = defineRouteMeta({ title: 'Dashboard - Ally' });

@Component({
  providers: [AuditStore],
  imports: [
    AppShellComponent,
    AuditFormComponent,
    AuditProgressComponent,
    RecentAuditsComponent,
    VoltBadge,
    LmnCheckCircleIcon,
    LmnDocumentTextIcon,
    LmnInformationCircleIcon,
    LmnPresentationChartBarIcon,
    ...MOVEMENT_DIRECTIVES,
  ],
  template: `
    <ally-app-shell badge="Automated audit MVP" [showSignOut]="true">
      <section class="grid flex-1 items-center gap-8 py-10 md:grid-cols-[1.04fr_0.96fr]">
        <div class="flex flex-col gap-5" [move]="'fade-up'">
          <p class="eyebrow">Hosted web audit</p>
          <h1 class="hero-title">Ally</h1>
          <p class="hero-copy">
            Run axe-core, IBM Equal Access, Siteimprove Alfa, QualWeb, HTML_CodeSniffer, and Ally's
            keyboard analyzer against one public page, then normalize, deduplicate, and score the
            findings.
          </p>
          <div class="flex flex-wrap gap-2">
            <volt-badge variant="outline">
              <lmn-presentation-chart-bar [size]="14" />
              5 engines
            </volt-badge>
            <volt-badge variant="outline">
              <lmn-document-text [size]="14" />
              JSON report
            </volt-badge>
            <volt-badge variant="outline">
              <lmn-check-circle [size]="14" />
              Normalized findings
            </volt-badge>
          </div>
          <div
            class="rounded-lg border border-[var(--ally-secondary-border)] bg-[var(--ally-secondary-bg)] p-4 text-sm text-[var(--ally-secondary-text)]"
            role="note"
          >
            <lmn-information-circle class="mr-2 inline-block align-text-bottom" [size]="16" />
            Automated auditing does not prove WCAG conformance. A clean automated result still
            requires manual review before you can claim accessibility.
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <ally-audit-form [authenticated]="authenticated()" />
          <ally-audit-progress />
        </div>
      </section>

      <ally-recent-audits (rerun)="rerun($event)" />
    </ally-app-shell>
  `,
})
export default class DashboardPageComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  readonly store = inject(AuditStore);
  readonly authenticated = signal(false);

  @ViewChild(AuditFormComponent) private auditForm?: AuditFormComponent;

  ngOnInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const authenticated = await this.auth.requireAuthenticated();
    this.authenticated.set(authenticated);
    if (authenticated) await this.store.loadRecentAudits();
  }

  ngOnDestroy(): void {
    this.store.destroy();
  }

  async rerun(url: string): Promise<void> {
    if (this.auditForm === undefined) return;
    this.auditForm.form.patchValue({ url });
    await this.auditForm.submit();
  }
}

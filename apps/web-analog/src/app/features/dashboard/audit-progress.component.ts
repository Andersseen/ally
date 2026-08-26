import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltButton, VoltCard } from '@voltui/components';
import { LmnAlertCircleIcon } from 'lumen-icons/alert-circle';
import { LmnCheckCircleIcon } from 'lumen-icons/check-circle';
import { LmnExternalLinkIcon } from 'lumen-icons/external-link';
import { LmnLoaderIcon } from 'lumen-icons/loader';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';
import { AuditStore } from './audit-store.service';

@Component({
  selector: 'ally-audit-progress',
  imports: [
    RouterLink,
    VoltButton,
    VoltCard,
    LmnAlertCircleIcon,
    LmnCheckCircleIcon,
    LmnExternalLinkIcon,
    LmnLoaderIcon,
    LmnXMarkIcon,
  ],
  template: `
    @if (store.status(); as status) {
      <volt-card>
        <div class="p-5">
          <div class="flex items-start gap-3" role="status" aria-live="polite" aria-atomic="true">
            <span class="status-dot mt-0.5" [attr.data-status-icon]="store.statusGroup()">
              @if (store.statusGroup() === 'completed') {
                <lmn-check-circle [size]="16" />
              } @else if (store.statusGroup() === 'failed') {
                <lmn-alert-circle [size]="16" />
              } @else {
                <lmn-loader [size]="16" />
              }
            </span>
            <div>
              <h2 class="text-ally-ink text-base font-semibold">{{ store.statusTitle() }}</h2>
              <p class="text-ally-muted mt-1 text-sm">{{ store.statusMessage() }}</p>
              @if (store.stageMessage() !== '') {
                <p class="text-ally-muted mt-1 text-xs">{{ store.stageMessage() }}</p>
              }
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            @if (store.canCancel()) {
              <volt-button
                type="button"
                variant="ghost"
                [disabled]="store.cancelling()"
                (click)="store.cancelActiveAudit()"
              >
                <lmn-x-mark slot="leading" [size]="16" />
                Stop audit
              </volt-button>
            }
            @if (store.completedAuditId(); as reportId) {
              <a
                class="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-400 px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                [routerLink]="['/reports']"
                [queryParams]="{ id: reportId }"
              >
                <lmn-external-link [size]="16" />
                View report
              </a>
            }
          </div>
        </div>
      </volt-card>
    }
  `,
})
export class AuditProgressComponent {
  readonly store = inject(AuditStore);
}

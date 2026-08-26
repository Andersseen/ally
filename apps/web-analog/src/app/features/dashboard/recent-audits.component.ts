import { Component, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltButton, VoltCard } from '@voltui/components';
import { LmnTrashIcon } from 'lumen-icons/trash';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';
import type { AuditListItem } from '../../core/api/ally-api.types';
import { auditDateLabel, isTerminalStatus, safeHostname } from '../../shared/utils/audit-ui';
import { AuditStore } from './audit-store.service';

@Component({
  selector: 'ally-recent-audits',
  imports: [RouterLink, VoltBadge, VoltButton, VoltCard, LmnTrashIcon, LmnXMarkIcon],
  template: `
    <section class="pb-10">
      <h2 class="text-ally-ink text-xl font-bold">Recent audits</h2>
      @if (store.recentLoading()) {
        <volt-card><p class="text-ally-muted p-5 text-sm">Loading recent audits...</p></volt-card>
      } @else if (store.recentError(); as error) {
        <volt-card
          ><p class="p-5 text-sm text-[var(--ally-danger)]">{{ error }}</p></volt-card
        >
      } @else if (store.recentAudits().length === 0) {
        <volt-card
          ><p class="text-ally-muted p-5 text-sm">No audits yet. Run one above.</p></volt-card
        >
      } @else {
        <ul class="mt-3 space-y-3" role="list">
          @for (audit of store.recentAudits(); track audit.id) {
            <li>
              <div
                class="rounded-lg border border-[var(--ally-secondary-border)] bg-[var(--ally-secondary-bg)] p-4"
              >
                <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div class="min-w-0">
                    <p class="text-ally-ink truncate font-semibold">{{ hostname(audit.url) }}</p>
                    <p class="text-ally-muted mt-1 break-all text-xs">{{ audit.url }}</p>
                    <p class="text-ally-muted mt-2 text-sm">{{ dateLabel(audit) }}</p>
                  </div>
                  <div class="text-ally-muted text-sm md:text-right">
                    <span class="sr-only">Score </span>
                    <span class="text-ally-ink text-lg font-bold tabular-nums">{{
                      score(audit)
                    }}</span>
                    <span>{{ audit.status === 'completed' ? '/100' : '' }}</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 md:justify-end">
                    <volt-badge [variant]="badgeVariant(audit)">{{ audit.status }}</volt-badge>
                    @if (audit.status === 'completed') {
                      <a
                        class="rounded-md border border-slate-400 px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        [routerLink]="['/reports']"
                        [queryParams]="{ id: audit.id }"
                      >
                        View report
                      </a>
                    }
                    @if (!terminal(audit)) {
                      <volt-button
                        variant="outline"
                        size="sm"
                        (click)="store.cancelAudit(audit.id)"
                      >
                        <lmn-x-mark slot="leading" [size]="14" />
                        Stop
                      </volt-button>
                    } @else {
                      <volt-button variant="outline" size="sm" (click)="rerun.emit(audit.url)">
                        Re-run
                      </volt-button>
                      <volt-button variant="ghost" size="sm" (click)="deleteAudit(audit.id)">
                        <lmn-trash slot="leading" [size]="14" />
                        Delete
                      </volt-button>
                    }
                  </div>
                </div>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class RecentAuditsComponent {
  readonly store = inject(AuditStore);
  readonly rerun = output<string>();

  hostname(url: string): string {
    return safeHostname(url);
  }

  dateLabel(audit: AuditListItem): string {
    return auditDateLabel(audit);
  }

  score(audit: AuditListItem): string {
    return audit.status === 'completed' && audit.summary?.score !== null
      ? String(audit.summary?.score ?? '')
      : '-';
  }

  terminal(audit: AuditListItem): boolean {
    return isTerminalStatus(audit.status);
  }

  badgeVariant(audit: AuditListItem): 'solid' | 'destructive' | 'secondary' {
    if (audit.status === 'failed') return 'destructive';
    if (audit.status === 'completed') return 'solid';
    return 'secondary';
  }

  async deleteAudit(id: string): Promise<void> {
    if (!window.confirm('Delete this audit and its report? This cannot be undone.')) return;
    await this.store.deleteAudit(id);
  }
}

import { computed, inject, Injectable, signal } from '@angular/core';
import { AllyApiService } from '../../core/api/ally-api.service';
import type {
  AuditListItem,
  AuditOptions,
  AuditStatusResponse,
} from '../../core/api/ally-api.types';
import {
  humanizeStage,
  isTerminalStatus,
  pollMessage,
  statusTitleFor,
  stepGroup,
} from '../../shared/utils/audit-ui';

@Injectable()
export class AuditStore {
  private readonly api = inject(AllyApiService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAttempt = 0;

  readonly activeAuditId = signal<string | null>(null);
  readonly status = signal<AuditStatusResponse | null>(null);
  readonly statusMessage = signal('');
  readonly recentAudits = signal<readonly AuditListItem[]>([]);
  readonly recentLoading = signal(false);
  readonly recentError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal<string | null>(null);

  readonly statusGroup = computed(() => {
    const status = this.status();
    return status === null ? 'queued' : stepGroup(status.status);
  });
  readonly statusTitle = computed(() => statusTitleFor(this.statusGroup()));
  readonly stageMessage = computed(() => humanizeStage(this.status()?.currentStage));
  readonly canCancel = computed(() => {
    const status = this.status();
    return status !== null && !isTerminalStatus(status.status);
  });
  readonly completedAuditId = computed(() => {
    const status = this.status();
    if (status?.status !== 'completed') return null;
    return status.id;
  });

  async loadRecentAudits(): Promise<void> {
    this.recentLoading.set(true);
    this.recentError.set(null);
    try {
      this.recentAudits.set(await this.api.audits());
    } catch (error) {
      this.recentError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.recentLoading.set(false);
    }
  }

  async startAudit(url: string, options: AuditOptions): Promise<void> {
    this.clearPoll();
    this.submitting.set(true);
    this.error.set(null);
    this.status.set({
      id: '',
      status: 'queued',
      currentStage: null,
      lastError: null,
    });
    this.statusMessage.set('Creating audit job.');
    try {
      const id = await this.api.createAudit(url, options);
      this.activeAuditId.set(id);
      this.statusMessage.set('Audit queued.');
      await this.poll(id);
    } catch (error) {
      this.showError(error);
    }
  }

  async cancelActiveAudit(): Promise<void> {
    const id = this.activeAuditId();
    if (id === null) return;
    this.cancelling.set(true);
    try {
      await this.api.cancelAudit(id);
      await this.poll(id);
    } catch (error) {
      this.showError(error);
    } finally {
      this.cancelling.set(false);
    }
  }

  async cancelAudit(id: string): Promise<void> {
    await this.api.cancelAudit(id);
    await this.loadRecentAudits();
    if (id === this.activeAuditId()) await this.poll(id);
  }

  async deleteAudit(id: string): Promise<void> {
    await this.api.deleteAudit(id);
    await this.loadRecentAudits();
  }

  destroy(): void {
    this.clearPoll();
  }

  private async poll(id: string): Promise<void> {
    this.activeAuditId.set(id);
    const audit = await this.api.audit(id);
    this.status.set(audit);
    this.statusMessage.set(
      pollMessage(audit.status, this.pollAttempt, audit.currentStage, audit.lastError),
    );

    if (isTerminalStatus(audit.status)) {
      this.activeAuditId.set(null);
      this.submitting.set(false);
      await this.loadRecentAudits();
      return;
    }

    this.pollAttempt += 1;
    this.pollTimer = setTimeout(() => {
      void this.poll(id).catch((error: unknown) => this.showError(error));
    }, 2000);
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.error.set(message);
    this.status.set({ id: this.activeAuditId() ?? '', status: 'failed', lastError: message });
    this.statusMessage.set(message);
    this.submitting.set(false);
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollAttempt = 0;
  }
}

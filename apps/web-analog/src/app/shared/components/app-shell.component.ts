import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeToggleComponent } from './theme-toggle.component';

@Component({
  selector: 'ally-app-shell',
  imports: [RouterLink, ThemeToggleComponent, VoltBadge, VoltButton, LmnArrowRightIcon],
  template: `
    <main class="shell flex min-h-screen flex-col gap-8">
      <header class="topbar flex flex-wrap items-center justify-between gap-4">
        <a class="brand-mark" routerLink="/">
          <span class="brand-icon" aria-hidden="true">
            <img class="brand-logo" src="/logo.svg" alt="" width="28" height="28" />
          </span>
          <span>Ally</span>
        </a>
        <div class="flex flex-wrap items-center gap-3">
          <volt-badge variant="secondary">{{ badge() }}</volt-badge>
          @if (showDashboardLink()) {
            <volt-button variant="outline" size="sm" routerLink="/dashboard">
              <lmn-arrow-right slot="leading" [size]="14" />
              New audit
            </volt-button>
          }
          @if (showSignOut()) {
            <volt-button variant="ghost" type="button" (click)="signOut()">Sign out</volt-button>
          }
          <ally-theme-toggle />
        </div>
      </header>
      <ng-content />
    </main>
  `,
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  readonly badge = input('Automated audit MVP');
  readonly reportMode = input(false);
  readonly showSignOut = input(false);
  readonly showDashboardLink = computed(() => this.reportMode());

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}

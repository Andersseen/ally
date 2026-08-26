import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { VoltCard } from '@voltui/components';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { defineRouteMeta } from '@analogjs/router';
import { AllyApiService } from '../core/api/ally-api.service';
import { AuthService } from '../core/auth/auth.service';
import { AppShellComponent } from '../shared/components/app-shell.component';

export const routeMeta = defineRouteMeta({ title: 'Sign in - Ally' });

@Component({
  imports: [AppShellComponent, VoltCard, LmnArrowRightIcon, ...MOVEMENT_DIRECTIVES],
  template: `
    <ally-app-shell badge="Protected audit dashboard">
      <section class="auth-shell py-10" [move]="'fade-up'">
        <volt-card class="w-full max-w-xl">
          <div class="flex flex-col gap-5 p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="eyebrow">Identity</p>
                <h1 class="text-ally-ink mt-2 text-4xl font-bold">Sign in to Ally</h1>
              </div>
              <span class="brand-icon" aria-hidden="true">
                <img class="brand-logo" src="/logo.svg" alt="" width="28" height="28" />
              </span>
            </div>
            <p class="hero-copy text-base">
              Hosted audits use Cloudflare resources, so the dashboard is available only after
              dev-auth verifies your session.
            </p>
            <p class="text-ally-muted text-sm" aria-live="polite">{{ status() }}</p>
            <div class="flex flex-wrap gap-2">
              <a
                class="native-button"
                [class.is-disabled]="loginDisabled()"
                [attr.aria-disabled]="loginDisabled()"
                [attr.href]="loginDisabled() ? null : api.loginUrl"
              >
                <lmn-arrow-right [size]="16" />
                Sign in
              </a>
            </div>
          </div>
        </volt-card>
      </section>
    </ally-app-shell>
  `,
})
export default class IndexPageComponent implements OnInit {
  readonly api = inject(AllyApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly status = signal('Checking sign-in...');
  readonly loginDisabled = signal(true);

  ngOnInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const session = await this.auth.refresh();
    if (session?.configured === false) {
      const missing =
        session.missingConfiguration?.join(', ') || 'ALLY_SESSION_SECRET, DEV_AUTH_CLIENT_SECRET';
      this.status.set(
        `Local auth is not configured. Copy apps/worker/.dev.vars.example to apps/worker/.dev.vars and set: ${missing}.`,
      );
      return;
    }
    if (session?.authenticated === true) {
      await this.router.navigateByUrl('/dashboard');
      return;
    }
    if (session !== null) {
      this.status.set(`Not signed in. Provider: ${session.provider?.issuer ?? 'dev-auth'}.`);
      this.loginDisabled.set(false);
      return;
    }
    this.status.set(this.auth.error() ?? 'Could not read identity status.');
  }
}

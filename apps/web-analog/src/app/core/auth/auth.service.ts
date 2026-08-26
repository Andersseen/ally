import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AllyApiService } from '../api/ally-api.service';
import type { AuthSession } from '../api/ally-api.types';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AllyApiService);
  private readonly router = inject(Router);

  readonly session = signal<AuthSession | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<AuthSession | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const session = await this.api.session();
      this.session.set(session);
      return session;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.session.set(null);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async requireAuthenticated(): Promise<boolean> {
    const session = await this.refresh();
    const canEnter = session?.configured === true && session.authenticated;
    if (!canEnter) await this.router.navigateByUrl('/');
    return canEnter;
  }

  async signOut(): Promise<void> {
    await this.api.logout();
    this.session.set(null);
    await this.router.navigateByUrl('/');
  }
}

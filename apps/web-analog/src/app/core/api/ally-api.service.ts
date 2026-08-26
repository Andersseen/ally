import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AuditListItem,
  AuditOptions,
  AuditResultJson,
  AuditStatusResponse,
  AuthSession,
} from './ally-api.types';

interface CreateAuditResponse {
  readonly id?: string;
  readonly status?: string;
  readonly error?: string;
}

@Injectable({ providedIn: 'root' })
export class AllyApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();

  readonly loginUrl = `${this.apiBase}/auth/login?returnTo=${encodeURIComponent('/dashboard')}`;

  session(): Promise<AuthSession> {
    return firstValueFrom(
      this.http.get<AuthSession>(`${this.apiBase}/auth/session`, { withCredentials: true }),
    );
  }

  logout(): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.apiBase}/auth/logout`, null, { withCredentials: true }),
    );
  }

  async createAudit(url: string, options: AuditOptions): Promise<string> {
    const body = await firstValueFrom(
      this.http.post<CreateAuditResponse>(
        `${this.apiBase}/audits`,
        { url, options },
        { withCredentials: true },
      ),
    );
    if (body.id === undefined) throw new Error(body.error ?? 'Could not create audit.');
    return body.id;
  }

  audit(id: string): Promise<AuditStatusResponse> {
    return firstValueFrom(
      this.http.get<AuditStatusResponse>(`${this.apiBase}/audits/${id}`, {
        withCredentials: true,
      }),
    );
  }

  async audits(): Promise<readonly AuditListItem[]> {
    const body = await firstValueFrom(
      this.http.get<{ readonly audits: readonly AuditListItem[] }>(`${this.apiBase}/audits`, {
        withCredentials: true,
      }),
    );
    return body.audits;
  }

  result(id: string): Promise<AuditResultJson> {
    return firstValueFrom(
      this.http.get<AuditResultJson>(`${this.apiBase}/audits/${id}/result`, {
        withCredentials: true,
      }),
    );
  }

  cancelAudit(id: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.apiBase}/audits/${id}/cancel`, null, {
        withCredentials: true,
      }),
    );
  }

  deleteAudit(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.apiBase}/audits/${id}`, { withCredentials: true }),
    );
  }

  private resolveApiBase(): string {
    const publicBase = (import.meta.env as Readonly<Record<string, string | undefined>>)[
      'PUBLIC_ALLY_API_BASE'
    ];
    return publicBase === undefined ? '/__ally_api' : `${publicBase.replace(/\/$/, '')}/api`;
  }
}

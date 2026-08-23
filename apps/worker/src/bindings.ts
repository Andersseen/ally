import type { BrowserWorker } from '@cloudflare/playwright';
import type { AuthEnv } from './auth.js';
import type { RunnerAuthEnv } from './runner-auth.js';

export interface Env extends AuthEnv, RunnerAuthEnv {
  readonly BROWSER: BrowserWorker;
  readonly DB: D1Database;
  readonly ARTIFACTS: R2Bucket;
  readonly AUDIT_QUEUE: Queue<AuditJobMessage>;
  readonly AUDIT_RUNNER: ContainerNamespace;
  /** Caps re-claim attempts per audit. Defaults to 3 when unset. */
  readonly AUDIT_MAX_ATTEMPTS?: string;
}

/**
 * The wire shape of a queued audit job. Deliberately smaller than
 * `@ally/runner-core`'s `AuditJob` (no `attempt`) — the Worker's D1 row is
 * the single source of truth for attempt counts, established at claim time,
 * not carried on the queue message.
 */
export interface AuditJobMessage {
  readonly id: string;
  readonly url: string;
  readonly options?: {
    readonly only?: readonly string[];
    readonly keyboard?: boolean;
    readonly recommendations?: boolean;
    readonly markupValidation?: boolean;
  };
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ readonly results: readonly T[] }>;
  run(): Promise<unknown>;
}

export interface R2Bucket {
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export interface R2ObjectBody {
  readonly body: ReadableStream;
  readonly httpMetadata?: { readonly contentType?: string };
}

export interface Queue<T> {
  send(message: T): Promise<void>;
}

export interface ContainerNamespace {
  getByName(name: string): ContainerStub;
}

export interface ContainerStub {
  startAndWaitForPorts(options?: {
    readonly startOptions?: {
      readonly envVars?: Record<string, string>;
    };
  }): Promise<void>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

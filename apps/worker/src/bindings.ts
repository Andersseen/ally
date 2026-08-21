import type { BrowserWorker } from '@cloudflare/playwright';

export interface Env {
  readonly BROWSER: BrowserWorker;
  readonly DB: D1Database;
  readonly ARTIFACTS: R2Bucket;
  readonly AUDIT_QUEUE: Queue<AuditJob>;
  readonly PUBLIC_WEB_ORIGIN?: string;
}

export interface AuditJob {
  readonly id: string;
  readonly url: string;
  readonly options?: {
    readonly only?: readonly string[];
    readonly keyboard?: boolean;
    readonly timeoutMs?: number;
  };
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
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

export interface MessageBatch<T> {
  readonly messages: readonly Message<T>[];
}

export interface Message<T> {
  readonly body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

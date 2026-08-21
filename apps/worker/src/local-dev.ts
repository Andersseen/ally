import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performAudit } from '@ally/cli';
import type { AuditResult } from '@ally/core';

const HOST = '127.0.0.1';
const PORT = 8787;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const AUDIT_ROOT = join(process.cwd(), '.local-audits');

type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

interface LocalAudit {
  readonly id: string;
  readonly url: string;
  status: AuditStatus;
  readonly createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: AuditResult;
}

const audits = new Map<string, LocalAudit>();

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    console.error(error);
    send(response, request, { error: 'Internal server error' }, 500);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ally local audit API listening on http://${HOST}:${String(PORT)}`);
});

process.once('SIGINT', () => {
  server.close(() => process.exit(130));
});

process.once('SIGTERM', () => {
  server.close(() => process.exit(143));
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'OPTIONS') {
    sendRaw(response, request, 204);
    return;
  }

  const url = new URL(request.url ?? '/', `http://${HOST}:${String(PORT)}`);

  if (request.method === 'POST' && url.pathname === '/api/audits') {
    await createAudit(request, response);
    return;
  }

  const resultMatch = /^\/api\/audits\/([^/]+)\/result$/.exec(url.pathname);
  if (request.method === 'GET' && resultMatch?.[1] !== undefined) {
    getAuditResult(resultMatch[1], request, response);
    return;
  }

  const auditMatch = /^\/api\/audits\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && auditMatch?.[1] !== undefined) {
    getAudit(auditMatch[1], request, response);
    return;
  }

  send(response, request, { error: 'Not found' }, 404);
}

async function createAudit(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = parseJsonObject(await readBody(request));
  const normalized = normalizePublicUrl(body?.url);

  if (normalized.status === 'invalid') {
    send(response, request, { error: normalized.message }, 400);
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const audit: LocalAudit = {
    id,
    url: normalized.url,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  audits.set(id, audit);
  queueMicrotask(() => void runAudit(audit));
  send(response, request, { id, status: audit.status }, 202);
}

function getAudit(id: string, request: IncomingMessage, response: ServerResponse): void {
  const audit = audits.get(id);
  if (audit === undefined) {
    send(response, request, { error: 'Audit not found' }, 404);
    return;
  }

  send(response, request, {
    id: audit.id,
    url: audit.url,
    status: audit.status,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    error: audit.error,
    summary:
      audit.result === undefined
        ? undefined
        : {
            score: audit.result.score.value,
            uniqueFindings: audit.result.summary.uniqueFindings,
            enginesSucceeded: audit.result.coverage.enginesSucceeded,
            enginesConfigured: audit.result.coverage.enginesConfigured,
          },
    resultUrl: audit.status === 'completed' ? `/api/audits/${audit.id}/result` : undefined,
  });
}

function getAuditResult(id: string, request: IncomingMessage, response: ServerResponse): void {
  const audit = audits.get(id);
  if (audit === undefined) {
    send(response, request, { error: 'Audit not found' }, 404);
    return;
  }

  if (audit.result === undefined) {
    send(response, request, { error: 'Audit result is not available yet' }, 409);
    return;
  }

  send(response, request, audit.result);
}

async function runAudit(audit: LocalAudit): Promise<void> {
  audit.status = 'running';
  audit.startedAt = new Date().toISOString();
  audit.updatedAt = audit.startedAt;

  try {
    await mkdir(AUDIT_ROOT, { recursive: true });
    const outcome = await performAudit({
      url: audit.url,
      outDir: join(AUDIT_ROOT, audit.id),
      only: [],
      keyboard: true,
      buildReport: false,
      headless: true,
      timeoutMs: 30_000,
    });

    audit.result = outcome.run.result;
    audit.status = 'completed';
    audit.completedAt = new Date().toISOString();
    audit.updatedAt = audit.completedAt;
  } catch (error) {
    audit.status = 'failed';
    audit.completedAt = new Date().toISOString();
    audit.updatedAt = audit.completedAt;
    audit.error = error instanceof Error ? error.message : String(error);
  }
}

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, rejectRead) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('error', rejectRead);
    request.on('end', () => resolveRead(body));
  });
}

function normalizePublicUrl(value: unknown):
  | { readonly status: 'ok'; readonly url: string }
  | { readonly status: 'invalid'; readonly message: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { status: 'invalid', message: 'Provide a URL.' };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { status: 'invalid', message: 'Provide a valid absolute URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { status: 'invalid', message: 'Only http:// and https:// URLs can be audited.' };
  }

  if (url.username !== '' || url.password !== '') {
    return { status: 'invalid', message: 'Credentials in URLs are not accepted.' };
  }

  url.hash = '';
  return { status: 'ok', url: url.toString() };
}

function send(
  response: ServerResponse,
  request: IncomingMessage,
  value: unknown,
  status = 200,
): void {
  const body = JSON.stringify(value);
  sendRaw(response, request, status, body);
}

function sendRaw(
  response: ServerResponse,
  request: IncomingMessage,
  status: number,
  body?: string,
): void {
  response.writeHead(status, {
    ...JSON_HEADERS,
    'access-control-allow-origin': allowedOrigin(request.headers.origin),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  });
  response.end(body);
}

function allowedOrigin(origin: string | undefined): string {
  if (origin === 'http://127.0.0.1:4321' || origin === 'http://localhost:4321') {
    return origin;
  }
  return 'http://127.0.0.1:4321';
}

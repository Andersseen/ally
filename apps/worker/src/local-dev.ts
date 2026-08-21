import { createServer } from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performAudit } from '@ally/cli';
import type { AuditResult } from '@ally/core';
import {
  AuthConfigurationError,
  OidcError,
  authIsConfigured,
  authorizationUrl,
  clearSessionCookie,
  clearTransactionCookie,
  createLoginTransaction,
  exchangeCode,
  fetchUserInfo,
  mergeAuthUsers,
  readSession,
  readTransaction,
  resolveOidcConfig,
  safeReturnTo,
  sessionCookie,
  transactionCookie,
  validateCallbackIssuer,
  verifyIdToken,
  webOrigin,
  discoverOidc,
} from './auth.ts';
import type { AuthEnv, AuthSession } from './auth.ts';

const HOST = '127.0.0.1';
const PORT = 8787;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const AUDIT_ROOT = join(process.cwd(), '.local-audits');
const authEnv = localAuthEnv();

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
  readonly ownerUserId: string;
  readonly ownerEmail: string;
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

  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    await getAuthSession(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/login') {
    await startAuthLogin(url, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/callback') {
    await completeAuthLogin(url, request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    sendRaw(response, request, 200, JSON.stringify({ ok: true }), [clearSessionCookie()]);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/audits') {
    const session = await requireAuth(request, response);
    if (session === null) return;
    await createAudit(request, response, session);
    return;
  }

  const resultMatch = /^\/api\/audits\/([^/]+)\/result$/.exec(url.pathname);
  if (request.method === 'GET' && resultMatch?.[1] !== undefined) {
    const session = await requireAuth(request, response);
    if (session === null) return;
    getAuditResult(resultMatch[1], request, response, session);
    return;
  }

  const auditMatch = /^\/api\/audits\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && auditMatch?.[1] !== undefined) {
    const session = await requireAuth(request, response);
    if (session === null) return;
    getAudit(auditMatch[1], request, response, session);
    return;
  }

  send(response, request, { error: 'Not found' }, 404);
}

async function getAuthSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let session = null;
  try {
    session = await readSession(request.headers.cookie, authEnv);
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
  }

  const config = resolveOidcConfig(authEnv);
  send(response, request, {
    authenticated: session !== null,
    user: session?.user,
    expiresAt: session?.expiresAt,
    configured: authIsConfigured(authEnv),
    provider: {
      issuer: config.issuer,
      clientId: config.clientId,
    },
    loginUrl: `/api/auth/login?returnTo=${encodeURIComponent('/dashboard')}`,
  });
}

async function startAuthLogin(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const config = resolveOidcConfig(authEnv);
  const transaction = createLoginTransaction(url.searchParams.get('returnTo') ?? '/');
  redirect(response, await authorizationUrl(config, transaction), [
    transactionCookie(transaction, isSecureRequest(request)),
  ]);
}

async function completeAuthLogin(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const transaction = readTransaction(request.headers.cookie);
  const clearTransaction = clearTransactionCookie();
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const issuer = url.searchParams.get('iss');

  if (providerError !== null) {
    redirect(response, authRedirectUrl('/', providerError), [clearTransaction]);
    return;
  }

  if (transaction === null || code === null || state !== transaction.state) {
    redirect(response, authRedirectUrl('/', 'invalid_state'), [clearTransaction]);
    return;
  }

  try {
    const config = resolveOidcConfig(authEnv);
    if (!validateCallbackIssuer(issuer, config)) {
      redirect(response, authRedirectUrl('/', 'invalid_issuer'), [clearTransaction]);
      return;
    }

    const endpoints = await discoverOidc(config);
    const tokens = await exchangeCode(config, endpoints, code, transaction.verifier);
    const idTokenUser = await verifyIdToken(config, endpoints, tokens.idToken, transaction.nonce);
    const userInfo = await fetchUserInfo(endpoints, tokens.accessToken);
    const user = mergeAuthUsers(idTokenUser, userInfo);
    redirect(response, authRedirectUrl(safeReturnTo(transaction.returnTo)), [
      clearTransaction,
      await sessionCookie(user, authEnv, isSecureRequest(request)),
    ]);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      send(response, request, { error: error.message }, 503);
      return;
    }
    if (error instanceof OidcError) {
      redirect(response, authRedirectUrl('/', error.message), [clearTransaction]);
      return;
    }
    throw error;
  }
}

async function requireAuth(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<AuthSession | null> {
  if (!authIsConfigured(authEnv)) {
    send(response, request, { error: 'Authentication is not configured' }, 503);
    return null;
  }

  try {
    const session = await readSession(request.headers.cookie, authEnv);
    if (session !== null) return session;
    send(response, request, { error: 'Authentication required' }, 401);
    return null;
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      send(response, request, { error: 'Authentication is not configured' }, 503);
      return null;
    }
    throw error;
  }
}

async function createAudit(
  request: IncomingMessage,
  response: ServerResponse,
  session: AuthSession,
): Promise<void> {
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
    ownerUserId: session.user.id,
    ownerEmail: session.user.email,
  };

  audits.set(id, audit);
  queueMicrotask(() => void runAudit(audit));
  send(response, request, { id, status: audit.status }, 202);
}

function getAudit(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  session: AuthSession,
): void {
  const audit = audits.get(id);
  if (audit === undefined || audit.ownerUserId !== session.user.id) {
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

function getAuditResult(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  session: AuthSession,
): void {
  const audit = audits.get(id);
  if (audit === undefined || audit.ownerUserId !== session.user.id) {
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
  cookies: readonly string[] = [],
): void {
  const headers: OutgoingHttpHeaders = {
    ...JSON_HEADERS,
    'access-control-allow-origin': allowedOrigin(request.headers.origin),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  response.writeHead(status, headers);
  response.end(body);
}

function allowedOrigin(origin: string | undefined): string {
  if (origin === 'http://127.0.0.1:4321' || origin === 'http://localhost:4321') {
    return origin;
  }
  return 'http://127.0.0.1:4321';
}

function redirect(response: ServerResponse, location: string, cookies: readonly string[] = []): void {
  const headers: OutgoingHttpHeaders = {
    location,
  };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  response.writeHead(302, headers);
  response.end();
}

function authRedirectUrl(returnTo: string, error?: string): string {
  const url = new URL(safeReturnTo(returnTo), webOrigin(authEnv));
  if (error !== undefined) url.searchParams.set('auth_error', error);
  return url.toString();
}

function isSecureRequest(request: IncomingMessage): boolean {
  return request.headers['x-forwarded-proto'] === 'https';
}

function localAuthEnv(): AuthEnv {
  const devVars = readDevVars();
  return {
    PUBLIC_WEB_ORIGIN:
      process.env.PUBLIC_WEB_ORIGIN ?? devVars.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:4321',
    ...((process.env.DEV_AUTH_URL ?? devVars.DEV_AUTH_URL) === undefined
      ? {}
      : { DEV_AUTH_URL: process.env.DEV_AUTH_URL ?? devVars.DEV_AUTH_URL }),
    ...((process.env.DEV_AUTH_CLIENT_ID ?? devVars.DEV_AUTH_CLIENT_ID) === undefined
      ? {}
      : { DEV_AUTH_CLIENT_ID: process.env.DEV_AUTH_CLIENT_ID ?? devVars.DEV_AUTH_CLIENT_ID }),
    ...((process.env.DEV_AUTH_CLIENT_SECRET ?? devVars.DEV_AUTH_CLIENT_SECRET) === undefined
      ? {}
      : {
          DEV_AUTH_CLIENT_SECRET:
            process.env.DEV_AUTH_CLIENT_SECRET ?? devVars.DEV_AUTH_CLIENT_SECRET,
        }),
    ...((process.env.DEV_AUTH_REDIRECT_URI ?? devVars.DEV_AUTH_REDIRECT_URI) === undefined
      ? {}
      : {
          DEV_AUTH_REDIRECT_URI:
            process.env.DEV_AUTH_REDIRECT_URI ?? devVars.DEV_AUTH_REDIRECT_URI,
        }),
    ALLY_SESSION_SECRET:
      process.env.ALLY_SESSION_SECRET ??
      devVars.ALLY_SESSION_SECRET ??
      'local-dev-only-insecure-ally-session-secret',
  };
}

function readDevVars(): Record<string, string> {
  try {
    return parseDevVars(readFileSync('.dev.vars', 'utf8'));
  } catch {
    return {};
  }
}

function parseDevVars(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    values[key] = stripQuotes(rawValue);
  }
  return values;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

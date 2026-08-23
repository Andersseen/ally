import { createServer } from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AuditResult, AuditRun } from '@ally/core';
import { PlaywrightChromiumBrowserProvider, executeAuditJob } from '@ally/runner-core';
import type {
  AuditBudgets,
  AuditJob,
  ClaimResult,
  NetworkPolicy,
  RunnerPersistencePort,
} from '@ally/runner-core';
import type { AuditStatus, AuditTransitionEvent } from './audit-state.ts';
import { isTerminalStatus, nextState } from './audit-state.ts';
import {
  AuthConfigurationError,
  OidcError,
  authIsConfigured,
  authMissingConfiguration,
  authorizationUrl,
  clearSessionCookie,
  clearTransactionCookie,
  createLoginTransaction,
  discoverOidc,
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
} from './auth.ts';
import type { AuthEnv, AuthSession } from './auth.ts';

const HOST = '127.0.0.1';
const PORT = 8787;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const AUDIT_LIST_LIMIT = 20;

interface LocalAudit {
  readonly id: string;
  readonly url: string;
  status: AuditStatus;
  currentStage: string | null;
  attempt: number;
  readonly createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  result?: AuditResult;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
}

interface LocalDevContext {
  readonly audits: Map<string, LocalAudit>;
  readonly persistence: RunnerPersistencePort;
  readonly budgets: AuditBudgets;
  readonly networkPolicy: NetworkPolicy;
  readonly authEnv: AuthEnv;
}

export interface LocalDevServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Builds (but does not start) the local hosted-audit stack: the same
 * `executeAuditJob` from `@ally/runner-core` the standalone hosted runner
 * uses, wired to an in-memory job source and persistence instead of
 * Cloudflare Queues/D1/R2. This exists so `pnpm dev` exercises the real
 * runner code path, and so tests can start/stop the whole HTTP surface
 * without a real Cloudflare account.
 */
export function createLocalDevServer(
  options: { readonly port?: number; readonly host?: string } = {},
): Promise<LocalDevServer> {
  const host = options.host ?? HOST;
  const audits = new Map<string, LocalAudit>();
  const context: LocalDevContext = {
    audits,
    persistence: createInMemoryPersistence(audits),
    budgets: budgetsFromEnv(),
    networkPolicy: networkPolicyFromEnv(),
    authEnv: localAuthEnv(),
  };

  const server = createServer((request, response) => {
    void handle(request, response, context).catch((error: unknown) => {
      console.error(error);
      send(response, request, context, { error: 'Internal server error' }, 500);
    });
  });

  return new Promise((resolveListening) => {
    server.listen(options.port ?? PORT, host, () => {
      resolveListening({
        url: `http://${host}:${String(portOf(server, options.port ?? PORT))}`,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

function portOf(server: Server, fallback: number): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : fallback;
}

function createInMemoryPersistence(
  audits: Map<string, LocalAudit> = new Map(),
): RunnerPersistencePort {
  const find = (id: string): LocalAudit => {
    const audit = audits.get(id);
    if (audit === undefined) throw new Error(`No local audit record for ${id}.`);
    return audit;
  };

  const transition = (audit: LocalAudit, event: AuditTransitionEvent): void => {
    const next = nextState(audit.status, event);
    if (next !== null) audit.status = next;
    audit.updatedAt = new Date().toISOString();
  };

  return {
    claim: (job: AuditJob): Promise<ClaimResult> => {
      const audit = audits.get(job.id);
      if (audit === undefined || isTerminalStatus(audit.status)) return Promise.resolve('terminal');
      const next = nextState(audit.status, 'claim');
      if (next === null) return Promise.resolve('terminal');
      audit.status = next;
      audit.attempt += 1;
      audit.updatedAt = new Date().toISOString();
      return Promise.resolve('claimed');
    },
    markRunning: (job: AuditJob): Promise<void> => {
      const audit = find(job.id);
      transition(audit, 'start');
      audit.startedAt ??= audit.updatedAt;
      return Promise.resolve();
    },
    reportStage: (job: AuditJob, event): Promise<void> => {
      const audit = audits.get(job.id);
      if (audit !== undefined && !isTerminalStatus(audit.status)) {
        audit.currentStage = `${event.stage}:${event.status}`;
        audit.updatedAt = new Date().toISOString();
      }
      return Promise.resolve();
    },
    markPersisting: (job: AuditJob): Promise<void> => {
      transition(find(job.id), 'persist');
      return Promise.resolve();
    },
    complete: (job: AuditJob, run: AuditRun): Promise<void> => {
      const audit = find(job.id);
      transition(audit, 'complete');
      audit.currentStage = null;
      audit.result = run.result;
      audit.completedAt = audit.updatedAt;
      return Promise.resolve();
    },
    fail: (job: AuditJob, category, message): Promise<void> => {
      const audit = find(job.id);
      transition(audit, category === 'audit-timeout' ? 'timeout' : 'fail');
      audit.currentStage = null;
      audit.lastError = message;
      audit.completedAt = audit.updatedAt;
      return Promise.resolve();
    },
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
): Promise<void> {
  if (request.method === 'OPTIONS') {
    sendRaw(response, request, ctx, 204);
    return;
  }

  const url = new URL(request.url ?? '/', `http://${HOST}:${String(PORT)}`);

  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    await getAuthSession(request, response, ctx);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/login') {
    await startAuthLogin(url, request, response, ctx);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/callback') {
    await completeAuthLogin(url, request, response, ctx);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    sendRaw(response, request, ctx, 200, JSON.stringify({ ok: true }), [clearSessionCookie()]);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/audits') {
    const session = await requireAuth(request, response, ctx);
    if (session === null) return;
    await createAudit(request, response, ctx, session);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/audits') {
    const session = await requireAuth(request, response, ctx);
    if (session === null) return;
    listAudits(request, response, ctx, session);
    return;
  }

  const resultMatch = /^\/api\/audits\/([^/]+)\/result$/.exec(url.pathname);
  if (request.method === 'GET' && resultMatch?.[1] !== undefined) {
    const session = await requireAuth(request, response, ctx);
    if (session === null) return;
    getAuditResult(resultMatch[1], request, response, ctx, session);
    return;
  }

  const cancelMatch = /^\/api\/audits\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === 'POST' && cancelMatch?.[1] !== undefined) {
    const session = await requireAuth(request, response, ctx);
    if (session === null) return;
    cancelAudit(cancelMatch[1], request, response, ctx, session);
    return;
  }

  const auditMatch = /^\/api\/audits\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && auditMatch?.[1] !== undefined) {
    const session = await requireAuth(request, response, ctx);
    if (session === null) return;
    getAudit(auditMatch[1], request, response, ctx, session);
    return;
  }

  send(response, request, ctx, { error: 'Not found' }, 404);
}

async function getAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
): Promise<void> {
  let session = null;
  try {
    session = await readSession(request.headers.cookie, ctx.authEnv);
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
  }

  const config = resolveOidcConfig(ctx.authEnv);
  send(response, request, ctx, {
    authenticated: session !== null,
    user: session?.user,
    expiresAt: session?.expiresAt,
    configured: authIsConfigured(ctx.authEnv),
    missingConfiguration: authMissingConfiguration(ctx.authEnv),
    provider: { issuer: config.issuer, clientId: config.clientId },
    loginUrl: `/api/auth/login?returnTo=${encodeURIComponent('/dashboard')}`,
  });
}

async function startAuthLogin(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
): Promise<void> {
  if (!authIsConfigured(ctx.authEnv)) {
    redirect(response, authRedirectUrl(ctx, '/', 'auth_not_configured'));
    return;
  }
  const config = resolveOidcConfig(ctx.authEnv);
  const transaction = createLoginTransaction(url.searchParams.get('returnTo') ?? '/');
  redirect(response, await authorizationUrl(config, transaction), [
    transactionCookie(transaction, isSecureRequest(request)),
  ]);
}

async function completeAuthLogin(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
): Promise<void> {
  const transaction = readTransaction(request.headers.cookie);
  const clearTransaction = clearTransactionCookie();
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const issuer = url.searchParams.get('iss');

  if (providerError !== null) {
    redirect(response, authRedirectUrl(ctx, '/', providerError), [clearTransaction]);
    return;
  }

  if (transaction === null || code === null || state !== transaction.state) {
    redirect(response, authRedirectUrl(ctx, '/', 'invalid_state'), [clearTransaction]);
    return;
  }

  try {
    const config = resolveOidcConfig(ctx.authEnv);
    if (!validateCallbackIssuer(issuer, config)) {
      redirect(response, authRedirectUrl(ctx, '/', 'invalid_issuer'), [clearTransaction]);
      return;
    }

    const endpoints = await discoverOidc(config);
    const tokens = await exchangeCode(config, endpoints, code, transaction.verifier);
    const idTokenUser = await verifyIdToken(config, endpoints, tokens.idToken, transaction.nonce);
    const userInfo = await fetchUserInfo(endpoints, tokens.accessToken);
    const user = mergeAuthUsers(idTokenUser, userInfo);
    redirect(response, authRedirectUrl(ctx, safeReturnTo(transaction.returnTo)), [
      clearTransaction,
      await sessionCookie(user, ctx.authEnv, isSecureRequest(request)),
    ]);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      send(response, request, ctx, { error: error.message }, 503);
      return;
    }
    if (error instanceof OidcError) {
      redirect(response, authRedirectUrl(ctx, '/', error.message), [clearTransaction]);
      return;
    }
    throw error;
  }
}

async function requireAuth(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
): Promise<AuthSession | null> {
  if (!authIsConfigured(ctx.authEnv)) {
    send(response, request, ctx, { error: 'Authentication is not configured' }, 503);
    return null;
  }

  try {
    const session = await readSession(request.headers.cookie, ctx.authEnv);
    if (session !== null) return session;
    send(response, request, ctx, { error: 'Authentication required' }, 401);
    return null;
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      send(response, request, ctx, { error: 'Authentication is not configured' }, 503);
      return null;
    }
    throw error;
  }
}

async function createAudit(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
  session: AuthSession,
): Promise<void> {
  const body = parseJsonObject(await readBody(request));
  const normalized = normalizePublicUrl(body?.url);

  if (normalized.status === 'invalid') {
    send(response, request, ctx, { error: normalized.message }, 400);
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const audit: LocalAudit = {
    id,
    url: normalized.url,
    status: 'queued',
    currentStage: null,
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    ownerUserId: session.user.id,
    ownerEmail: session.user.email,
  };

  ctx.audits.set(id, audit);
  queueMicrotask(() => {
    void executeAuditJob(
      { id, url: normalized.url, attempt: 1, options: { keyboard: true } },
      {
        browserProvider: new PlaywrightChromiumBrowserProvider(),
        persistence: ctx.persistence,
        budgets: ctx.budgets,
        networkPolicy: ctx.networkPolicy,
      },
    );
  });

  send(response, request, ctx, { id, status: audit.status }, 202);
}

function listAudits(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
  session: AuthSession,
): void {
  const audits = [...ctx.audits.values()]
    .filter((audit) => audit.ownerUserId === session.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, AUDIT_LIST_LIMIT)
    .map(auditJson);

  send(response, request, ctx, { audits });
}

function getAudit(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
  session: AuthSession,
): void {
  const audit = ctx.audits.get(id);
  if (audit === undefined || audit.ownerUserId !== session.user.id) {
    send(response, request, ctx, { error: 'Audit not found' }, 404);
    return;
  }

  send(response, request, ctx, auditJson(audit));
}

function getAuditResult(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
  session: AuthSession,
): void {
  const audit = ctx.audits.get(id);
  if (audit === undefined || audit.ownerUserId !== session.user.id) {
    send(response, request, ctx, { error: 'Audit not found' }, 404);
    return;
  }

  if (audit.result === undefined) {
    send(response, request, ctx, { error: 'Audit result is not available yet' }, 409);
    return;
  }

  send(response, request, ctx, audit.result);
}

function cancelAudit(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LocalDevContext,
  session: AuthSession,
): void {
  const audit = ctx.audits.get(id);
  if (audit === undefined || audit.ownerUserId !== session.user.id) {
    send(response, request, ctx, { error: 'Audit not found' }, 404);
    return;
  }

  const next = nextState(audit.status, 'cancel');
  if (next === null) {
    send(response, request, ctx, { error: 'Audit cannot be cancelled from its current state' }, 409);
    return;
  }

  const now = new Date().toISOString();
  audit.status = next;
  audit.currentStage = null;
  audit.lastError = 'Cancelled by user.';
  audit.completedAt = now;
  audit.updatedAt = now;

  send(response, request, ctx, { status: next });
}

function auditJson(audit: LocalAudit): Record<string, unknown> {
  return {
    id: audit.id,
    url: audit.url,
    status: audit.status,
    currentStage: audit.currentStage,
    attempt: audit.attempt,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    lastError: audit.lastError,
    summary:
      audit.result === undefined
        ? undefined
        : {
            score: audit.result.score.value,
            scoreVersion: audit.result.score.version,
            uniqueFindings: audit.result.summary.uniqueFindings,
            rawFindings: audit.result.summary.totalFindings,
            keyboardWarnings: audit.result.summary.keyboard?.anomalies ?? null,
            enginesSucceeded: audit.result.coverage.enginesSucceeded,
            enginesConfigured: audit.result.coverage.enginesConfigured,
            enginesFailed: audit.result.summary.enginesFailed,
          },
    resultUrl: audit.status === 'completed' ? `/api/audits/${audit.id}/result` : undefined,
  };
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

function normalizePublicUrl(
  value: unknown,
):
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
  ctx: LocalDevContext,
  value: unknown,
  status = 200,
): void {
  sendRaw(response, request, ctx, status, JSON.stringify(value));
}

function sendRaw(
  response: ServerResponse,
  request: IncomingMessage,
  ctx: LocalDevContext,
  status: number,
  body?: string,
  cookies: readonly string[] = [],
): void {
  const headers: OutgoingHttpHeaders = {
    ...JSON_HEADERS,
    'access-control-allow-origin': allowedOrigin(request.headers.origin, ctx),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  response.writeHead(status, headers);
  response.end(body);
}

function allowedOrigin(origin: string | undefined, ctx: LocalDevContext): string {
  const configured = ctx.authEnv.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:4321';
  if (
    origin === configured ||
    origin === 'http://127.0.0.1:4321' ||
    origin === 'http://localhost:4321'
  ) {
    return origin;
  }
  return configured;
}

function redirect(
  response: ServerResponse,
  location: string,
  cookies: readonly string[] = [],
): void {
  const headers: OutgoingHttpHeaders = { location };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  response.writeHead(302, headers);
  response.end();
}

function authRedirectUrl(ctx: LocalDevContext, returnTo: string, error?: string): string {
  const url = new URL(safeReturnTo(returnTo), webOrigin(ctx.authEnv));
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
          DEV_AUTH_REDIRECT_URI: process.env.DEV_AUTH_REDIRECT_URI ?? devVars.DEV_AUTH_REDIRECT_URI,
        }),
    ALLY_SESSION_SECRET:
      process.env.ALLY_SESSION_SECRET ??
      devVars.ALLY_SESSION_SECRET ??
      'local-dev-only-insecure-ally-session-secret',
  };
}

function budgetsFromEnv(): AuditBudgets {
  return {
    navigationTimeoutMs: readIntEnv('ALLY_NAVIGATION_TIMEOUT_MS', 30_000),
    auditTimeoutMs: readIntEnv('ALLY_AUDIT_TIMEOUT_MS', 120_000),
    maxRedirects: readIntEnv('ALLY_MAX_REDIRECTS', 5),
  };
}

/**
 * Unset by default — every target goes through the full SSRF guard.
 * `ALLY_SSRF_ALLOW_HOSTS` (comma-separated `host` or `host:port` values) is
 * a deliberate, narrow exception, not a general bypass: it exists so an
 * operator can audit one specific internal target, and so the hosted-flow
 * integration test can point the real guarded pipeline at its local fixture
 * server. Production deployments should leave it unset.
 */
function networkPolicyFromEnv(): NetworkPolicy {
  const raw = process.env.ALLY_SSRF_ALLOW_HOSTS;
  if (raw === undefined || raw.trim() === '') return {};

  const hosts = raw
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '');
  return hosts.length === 0 ? {} : { allowHostnames: new Set(hosts) };
}

function readIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
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

function isMainModule(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  void createLocalDevServer().then((instance) => {
    console.log(`Ally local audit API listening on ${instance.url}`);
    process.once('SIGINT', () => void instance.close().then(() => process.exit(130)));
    process.once('SIGTERM', () => void instance.close().then(() => process.exit(143)));
  });
}

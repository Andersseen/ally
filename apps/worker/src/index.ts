import { acquire, connect } from '@cloudflare/playwright';
import type { AuditPageOptions, AuditPageOutcome, EngineSelection } from '@ally/audit-runner';
import type { AllyPage } from '@ally/browser/page';
import type { AuditEngine, AuditRun, EngineDescriptor } from '@ally/core';
import { rawFileName, serializeJson } from '@ally/reporter-json';
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
  readSession,
  readTransaction,
  resolveOidcConfig,
  safeReturnTo,
  sessionCookie,
  transactionCookie,
  webOrigin,
} from './auth.js';
import type { AuthSession } from './auth.js';
import type { Env, AuditJob, MessageBatch } from './bindings.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

interface AuditRow {
  readonly id: string;
  readonly url: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly error: string | null;
  readonly score: number | null;
  readonly unique_findings: number | null;
  readonly engines_succeeded: number | null;
  readonly engines_configured: number | null;
  readonly artifact_key: string | null;
  readonly owner_user_id: string | null;
  readonly owner_email: string | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/session') {
        return withCors(await getAuthSession(request, env), request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/login') {
        return await startAuthLogin(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/callback') {
        return await completeAuthLogin(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        return withCors(logout(), request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/audits') {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await createAudit(request, env, session), request, env);
      }

      const auditMatch = /^\/api\/audits\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && auditMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await getAudit(auditMatch[1], env, session), request, env);
      }

      const resultMatch = /^\/api\/audits\/([^/]+)\/result$/.exec(url.pathname);
      if (request.method === 'GET' && resultMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await getAuditResult(resultMatch[1], env, session), request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/compatibility') {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await runCompatibilitySpike(url, env), request, env);
      }

      return withCors(json({ error: 'Not found' }, 404), request, env);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'request_failed', error }));
      return withCors(json({ error: 'Internal server error' }, 500), request, env);
    }
  },

  async queue(batch: MessageBatch<AuditJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await consumeAudit(message.body, env);
        message.ack();
      } catch (error) {
        if (isPermanentAuditFailure(error)) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              message: 'audit_consumer_permanent_failure',
              auditId: message.body.id,
              error: firstLine(error),
            }),
          );
          message.ack();
          continue;
        }

        console.error(
          JSON.stringify({
            level: 'error',
            message: 'audit_consumer_failed',
            auditId: message.body.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        message.retry({ delaySeconds: 30 });
      }
    }
  },
};

async function getAuthSession(request: Request, env: Env): Promise<Response> {
  let session = null;
  try {
    session = await readSession(request.headers.get('cookie'), env);
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
  }

  const config = resolveOidcConfig(env);
  return json({
    authenticated: session !== null,
    user: session?.user,
    expiresAt: session?.expiresAt,
    configured: authIsConfigured(env),
    provider: {
      issuer: config.issuer,
      clientId: config.clientId,
    },
    loginUrl: `/api/auth/login?returnTo=${encodeURIComponent('/dashboard')}`,
  });
}

async function startAuthLogin(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const config = resolveOidcConfig(env);
  const transaction = createLoginTransaction(requestUrl.searchParams.get('returnTo') ?? '/');
  return redirect(await authorizationUrl(config, transaction), [
    transactionCookie(transaction, isSecureRequest(request)),
  ]);
}

async function completeAuthLogin(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const transaction = readTransaction(request.headers.get('cookie'));
  const clearTransaction = clearTransactionCookie();
  const providerError = requestUrl.searchParams.get('error');
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');

  if (providerError !== null) {
    return redirect(authRedirectUrl(env, '/', providerError), [clearTransaction]);
  }

  if (transaction === null || code === null || state !== transaction.state) {
    return redirect(authRedirectUrl(env, '/', 'invalid_state'), [clearTransaction]);
  }

  try {
    const config = resolveOidcConfig(env);
    const accessToken = await exchangeCode(config, code, transaction.verifier);
    const user = await fetchUserInfo(config, accessToken);
    return redirect(authRedirectUrl(env, safeReturnTo(transaction.returnTo)), [
      clearTransaction,
      await sessionCookie(user, env, isSecureRequest(request)),
    ]);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return json({ error: error.message }, 503);
    }
    if (error instanceof OidcError) {
      return redirect(authRedirectUrl(env, '/', error.message), [clearTransaction]);
    }
    throw error;
  }
}

function logout(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      ...JSON_HEADERS,
      'set-cookie': clearSessionCookie(),
    },
  });
}

async function requireAuth(request: Request, env: Env): Promise<AuthSession | Response> {
  if (!authIsConfigured(env)) {
    return json({ error: 'Authentication is not configured' }, 503);
  }

  try {
    const session = await readSession(request.headers.get('cookie'), env);
    if (session !== null) return session;
    return json({ error: 'Authentication required' }, 401);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return json({ error: 'Authentication is not configured' }, 503);
    }
    throw error;
  }
}

async function createAudit(request: Request, env: Env, session: AuthSession): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const rawUrl = typeof body === 'object' && body !== null && 'url' in body ? body.url : undefined;
  const normalized = normalizePublicUrl(rawUrl);

  if (normalized.status === 'invalid') return json({ error: normalized.message }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO audits (id, url, status, created_at, updated_at, owner_user_id, owner_email)
     VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
  )
    .bind(id, normalized.url, now, now, session.user.id, session.user.email)
    .run();

  await env.AUDIT_QUEUE.send({ id, url: normalized.url, options: { keyboard: true } });

  return json({ id, status: 'queued' }, 202);
}

async function getAudit(id: string, env: Env, session: AuthSession): Promise<Response> {
  const row = await findAudit(id, env, session);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  return json({
    id: row.id,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    summary:
      row.status === 'completed'
        ? {
            score: row.score,
            uniqueFindings: row.unique_findings,
            enginesSucceeded: row.engines_succeeded,
            enginesConfigured: row.engines_configured,
          }
        : undefined,
    resultUrl: row.status === 'completed' ? `/api/audits/${row.id}/result` : undefined,
  });
}

async function getAuditResult(id: string, env: Env, session: AuthSession): Promise<Response> {
  const row = await findAudit(id, env, session);
  if (row === null) return json({ error: 'Audit not found' }, 404);
  if (row.status !== 'completed' || row.artifact_key === null) {
    return json({ error: 'Audit result is not available yet' }, 409);
  }

  const object = await env.ARTIFACTS.get(row.artifact_key);
  if (object === null) return json({ error: 'Audit artifact is missing' }, 404);

  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? JSON_HEADERS['content-type'] },
  });
}

async function consumeAudit(job: AuditJob, env: Env): Promise<void> {
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits
     SET status = 'running', started_at = ?, updated_at = ?, error = NULL
     WHERE id = ?`,
  )
    .bind(startedAt, startedAt, job.id)
    .run();

  try {
    const runtime = await loadAuditRuntime();
    const run = await withCloudflarePage(env, job.url, job.options?.timeoutMs, (page) =>
      runtime.auditPage({
        url: job.url,
        page,
        only: job.options?.only ?? [],
        keyboard: job.options?.keyboard ?? true,
      }),
    ).then((outcome) => outcome.run);

    const artifactKey = `audits/${job.id}/audit.json`;
    await persistRun(job.id, artifactKey, run, env);

    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE audits
       SET status = 'completed',
           completed_at = ?,
           updated_at = ?,
           score = ?,
           unique_findings = ?,
           engines_succeeded = ?,
           engines_configured = ?,
           artifact_key = ?
       WHERE id = ?`,
    )
      .bind(
        completedAt,
        completedAt,
        run.result.score.value,
        run.result.summary.uniqueFindings,
        run.result.coverage.enginesSucceeded,
        run.result.coverage.enginesConfigured,
        artifactKey,
        job.id,
      )
      .run();
  } catch (error) {
    const failedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE audits
       SET status = 'failed', completed_at = ?, updated_at = ?, error = ?
       WHERE id = ?`,
    )
      .bind(failedAt, failedAt, auditFailureMessage(error), job.id)
      .run();
    throw error;
  }
}

async function persistRun(id: string, artifactKey: string, run: AuditRun, env: Env): Promise<void> {
  await env.ARTIFACTS.put(artifactKey, serializeJson(run.result), {
    httpMetadata: { contentType: JSON_HEADERS['content-type'] },
  });

  for (const [engineId, raw] of run.raw) {
    await env.ARTIFACTS.put(`audits/${id}/raw/${rawFileName(engineId)}`, serializeJson(raw), {
      httpMetadata: { contentType: JSON_HEADERS['content-type'] },
    });
  }
}

async function runCompatibilitySpike(url: URL, env: Env): Promise<Response> {
  const normalized = normalizePublicUrl(url.searchParams.get('url'));
  if (normalized.status === 'invalid') return json({ error: normalized.message }, 400);

  const runtime = await loadAuditRuntime().catch((error: unknown) => ({ error }));

  if ('error' in runtime) {
    return json({
      url: normalized.url,
      runtime: 'cloudflare-workers-browser-run',
      generatedAt: new Date().toISOString(),
      loadError: firstLine(runtime.error),
      checks: staticCompatibilityFailureChecks(firstLine(runtime.error)),
    });
  }

  const checks = [];

  for (const descriptor of runtime.AVAILABLE_ENGINES) {
    const selection = runtime.selectEngines([descriptor.id]);
    const engine = selection.engines[0];
    checks.push(await checkEngine(normalized.url, engine, env));
  }

  checks.push(await checkKeyboard(normalized.url, env));

  return json({
    url: normalized.url,
    runtime: 'cloudflare-workers-browser-run',
    generatedAt: new Date().toISOString(),
    checks,
  });
}

async function checkEngine(
  url: string,
  engine: AuditEngine<AllyPage> | undefined,
  env: Env,
): Promise<Record<string, unknown>> {
  if (engine === undefined) {
    return { id: 'unknown', runsDirectlyInWorker: false, error: 'Engine is not registered.' };
  }

  const requirement = STATIC_COMPATIBILITY[engine.id] ?? {};
  const startedAt = Date.now();

  try {
    const output = await withCloudflarePage(env, url, undefined, (page) =>
      engine.run({ url, page }).then((raw) => ({ raw, normalized: engine.normalize(raw.raw) })),
    );

    return {
      id: engine.id,
      name: engine.name,
      runsDirectlyInWorker: true,
      durationMs: Date.now() - startedAt,
      rawCount: output.raw.rawCount,
      normalizedCount: output.normalized.length,
      ...requirement,
    };
  } catch (error) {
    return {
      id: engine.id,
      name: engine.name,
      runsDirectlyInWorker: false,
      durationMs: Date.now() - startedAt,
      error: firstLine(error),
      ...requirement,
    };
  }
}

async function checkKeyboard(url: string, env: Env): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  try {
    const runtime = await loadAuditRuntime();
    const outcome = await withCloudflarePage(env, url, undefined, (page) =>
      runtime.auditPage({ url, page, only: [], keyboard: true }),
    );
    return {
      id: 'keyboard',
      name: 'Keyboard analyzer',
      runsDirectlyInWorker: outcome.run.result.keyboard?.status === 'ok',
      durationMs: Date.now() - startedAt,
      requiresNodeApis: true,
      requiresFilesystem: true,
      requiresBrowserInjection: true,
      notes: ['Full audit path used so keyboard analyzer is represented in the same raw model.'],
    };
  } catch (error) {
    return {
      id: 'keyboard',
      name: 'Keyboard analyzer',
      runsDirectlyInWorker: false,
      durationMs: Date.now() - startedAt,
      error: firstLine(error),
      requiresNodeApis: true,
      requiresFilesystem: true,
      requiresBrowserInjection: true,
    };
  }
}

interface AuditRuntime {
  readonly auditPage: (options: AuditPageOptions) => Promise<AuditPageOutcome>;
  readonly AVAILABLE_ENGINES: readonly EngineDescriptor[];
  readonly selectEngines: (only?: readonly string[]) => EngineSelection;
}

async function loadAuditRuntime(): Promise<AuditRuntime> {
  return import('@ally/audit-runner');
}

async function withCloudflarePage<T>(
  env: Env,
  url: string,
  timeoutMs: number | undefined,
  use: (page: AllyPage) => Promise<T>,
): Promise<T> {
  const { sessionId } = await acquire(env.BROWSER);
  const browser = (await connect(env.BROWSER, sessionId)) as unknown as CloudflareBrowser;

  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(timeoutMs ?? 30_000);
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs ?? 30_000 });

    if (response !== null && !response.ok()) {
      throw new Error(`Navigation to ${url} returned HTTP ${String(response.status())}.`);
    }

    return await use(page);
  } finally {
    await browser.close();
  }
}

interface CloudflareBrowser {
  newContext(): Promise<CloudflareBrowserContext>;
  close(): Promise<void>;
}

interface CloudflareBrowserContext {
  setDefaultTimeout(timeoutMs: number): void;
  newPage(): Promise<CloudflarePage>;
}

interface CloudflarePage extends AllyPage {
  goto(
    url: string,
    options: { waitUntil: 'load'; timeout: number },
  ): Promise<{ ok(): boolean; status(): number } | null>;
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

async function findAudit(id: string, env: Env, session: AuthSession): Promise<AuditRow | null> {
  return env.DB.prepare(
    `SELECT id, url, status, created_at, updated_at, started_at, completed_at, error,
            score, unique_findings, engines_succeeded, engines_configured, artifact_key,
            owner_user_id, owner_email
     FROM audits
     WHERE id = ? AND owner_user_id = ?`,
  )
    .bind(id, session.user.id)
    .first<AuditRow>();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  headers.set('access-control-allow-origin', allowedOrigin(origin, env));
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-allow-credentials', 'true');
  headers.set('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function allowedOrigin(origin: string | null, env: Env): string {
  const configured = env.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:4321';
  const allowed = new Set([
    configured,
    'http://127.0.0.1:4321',
    'http://localhost:4321',
  ]);

  return origin !== null && allowed.has(origin) ? origin : configured;
}

function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function authRedirectUrl(env: Env, returnTo: string, error?: string): string {
  const url = new URL(safeReturnTo(returnTo), webOrigin(env));
  if (error !== undefined) url.searchParams.set('auth_error', error);
  return url.toString();
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.trim() ?? message;
}

function auditFailureMessage(error: unknown): string {
  if (isWorkerRuntimeCompatibilityError(error)) {
    return [
      'Cloudflare-native audits are not supported by the current engine adapters yet.',
      'The compatibility spike failed while loading Node-oriented adapters in Workers.',
      'Use the local CLI for full audits while the hosted runner moves to the hybrid Node architecture.',
    ].join(' ');
  }

  return firstLine(error);
}

function isPermanentAuditFailure(error: unknown): boolean {
  return isWorkerRuntimeCompatibilityError(error);
}

function isWorkerRuntimeCompatibilityError(error: unknown): boolean {
  const message = firstLine(error);
  return (
    message.includes("The argument 'path'") &&
    message.includes("Received 'undefined'")
  );
}

function staticCompatibilityFailureChecks(error: string): readonly Record<string, unknown>[] {
  return Object.entries(STATIC_COMPATIBILITY).map(([id, requirement]) => ({
    id,
    runsDirectlyInWorker: false,
    error,
    ...requirement,
  }));
}

const STATIC_COMPATIBILITY: Readonly<Record<string, Record<string, unknown>>> = {
  'axe-core': {
    requiresNodeApis: false,
    requiresFilesystem: false,
    requiresBrowserInjection: true,
  },
  'ibm-equal-access': {
    requiresNodeApis: true,
    requiresFilesystem: true,
    requiresBrowserInjection: true,
    notes: ['Current adapter resolves and reads package metadata with Node APIs.'],
  },
  alfa: {
    requiresNodeApis: false,
    requiresFilesystem: false,
    requiresBrowserInjection: false,
    notes: ['Uses @siteimprove/alfa-playwright against a Playwright document handle.'],
  },
  qualweb: {
    requiresNodeApis: true,
    requiresFilesystem: true,
    requiresBrowserInjection: true,
    notes: ['Current adapter resolves script bundles and package manifests with Node APIs.'],
  },
};

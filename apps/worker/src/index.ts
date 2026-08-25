import { acquire, connect } from '@cloudflare/playwright';
import type { AuditPageOptions, AuditPageOutcome, EngineSelection } from '@ally/audit-runner';
import type { AllyPage } from '@ally/browser/page';
import type { AuditEngine, EngineDescriptor } from '@ally/core';
import { SsrfBlockedError, assertSyntacticallyPublicUrl } from '@ally/net-guard';
import { rawFileName, serializeJson } from '@ally/reporter-json';
import type { AuditStatus, AuditTransitionEvent } from './audit-state.js';
import { isTerminalStatus, nextState } from './audit-state.js';
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
} from './auth.js';
import type { AuthSession } from './auth.js';
import type { AuditJobMessage, Env } from './bindings.js';
import { enrichResultWithWorkersAi } from './ai-review.js';
import { requireRunnerAuth } from './runner-auth.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_AUDIT_WINDOW_DAYS = 30;
const DEFAULT_USER_AUDIT_WINDOW_LIMIT = 30;
const DEFAULT_GLOBAL_AUDIT_WINDOW_LIMIT = 30;
const DEFAULT_GLOBAL_ACTIVE_AUDIT_LIMIT = 1;
const AUDIT_LIST_LIMIT = 20;

export { AuditRunnerContainer } from './audit-runner-container.js';

interface AuditRow {
  readonly id: string;
  readonly url: string;
  readonly status: AuditStatus;
  readonly current_stage: string | null;
  readonly attempt: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly last_error: string | null;
  readonly score: number | null;
  readonly score_version: number | null;
  readonly unique_findings: number | null;
  readonly raw_findings: number | null;
  readonly keyboard_warnings: number | null;
  readonly engines_succeeded: number | null;
  readonly engines_configured: number | null;
  readonly engines_failed: number | null;
  readonly artifact_key: string | null;
  readonly owner_user_id: string | null;
  readonly owner_email: string | null;
}

const AUDIT_COLUMNS = `id, url, status, current_stage, attempt, created_at, updated_at,
  started_at, completed_at, last_error, score, score_version, unique_findings, raw_findings,
  keyboard_warnings, engines_succeeded, engines_configured, engines_failed, artifact_key,
  owner_user_id, owner_email`;

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

      if (request.method === 'GET' && url.pathname === '/api/audits') {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await listAudits(env, session), request, env);
      }

      const resultMatch = /^\/api\/audits\/([^/]+)\/result$/.exec(url.pathname);
      if (request.method === 'GET' && resultMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await getAuditResult(resultMatch[1], env, session), request, env);
      }

      const cancelMatch = /^\/api\/audits\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === 'POST' && cancelMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await cancelAudit(cancelMatch[1], env, session), request, env);
      }

      const auditMatch = /^\/api\/audits\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && auditMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await getAudit(auditMatch[1], env, session), request, env);
      }

      if (request.method === 'DELETE' && auditMatch?.[1] !== undefined) {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await deleteAudit(auditMatch[1], env, session), request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/compatibility') {
        const session = await requireAuth(request, env);
        if (session instanceof Response) return withCors(session, request, env);
        return withCors(await runCompatibilitySpike(url, env), request, env);
      }

      const runnerMatch =
        /^\/api\/runner\/audits\/([^/]+)\/(claim|running|stage|persisting|complete|fail)$/.exec(
          url.pathname,
        );
      const runnerId = runnerMatch?.[1];
      const runnerAction = runnerMatch?.[2];
      if (request.method === 'POST' && runnerId !== undefined && isRunnerAction(runnerAction)) {
        const authorized = requireRunnerAuth(request, env);
        if (authorized !== true) return authorized;
        return await handleRunnerRoute(runnerId, runnerAction, request, env);
      }

      return withCors(json({ error: 'Not found' }, 404), request, env);
    } catch (error) {
      console.error(
        JSON.stringify({ level: 'error', message: 'request_failed', error: firstLine(error) }),
      );
      return withCors(json({ error: 'Internal server error' }, 500), request, env);
    }
  },

  async queue(batch: MessageBatch<AuditJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const runnerSecret = env.ALLY_RUNNER_SECRET?.trim();
        if (runnerSecret === undefined || runnerSecret === '') {
          throw new Error('ALLY_RUNNER_SECRET is not configured.');
        }

        await reportContainerStage(message.body.id, env, 'started');
        const container = env.AUDIT_RUNNER.getByName(message.body.id);
        await container.startAndWaitForPorts({
          startOptions: {
            envVars: {
              ALLY_WORKER_BASE_URL: webOrigin(env),
              ALLY_RUNNER_SECRET: runnerSecret,
              ALLY_RUNNER_ID: `container-${message.body.id}`,
            },
          },
        });
        await reportContainerStage(message.body.id, env, 'ok');
        const response = await container.fetch('http://container/run', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(message.body),
        });

        if (response.ok) message.ack();
        else message.retry();
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'container_dispatch_failed',
            auditId: message.body.id,
            error: firstLine(error),
          }),
        );
        await reportContainerStage(message.body.id, env, 'failed', firstLine(error));
        message.retry();
      }
    }
  },
};

interface MessageBatch<T> {
  readonly messages: readonly QueueMessage<T>[];
}

interface QueueMessage<T> {
  readonly body: T;
  ack(): void;
  retry(): void;
}

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
    missingConfiguration: authMissingConfiguration(env),
    provider: {
      issuer: config.issuer,
      clientId: config.clientId,
    },
    loginUrl: `/api/auth/login?returnTo=${encodeURIComponent('/dashboard')}`,
  });
}

async function startAuthLogin(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (!authIsConfigured(env)) {
    return redirect(authRedirectUrl(env, '/', 'auth_not_configured'));
  }
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
  const issuer = requestUrl.searchParams.get('iss');

  if (providerError !== null) {
    return redirect(authRedirectUrl(env, '/', providerError), [clearTransaction]);
  }

  if (transaction === null || code === null || state !== transaction.state) {
    return redirect(authRedirectUrl(env, '/', 'invalid_state'), [clearTransaction]);
  }

  try {
    const config = resolveOidcConfig(env);
    if (!validateCallbackIssuer(issuer, config)) {
      return redirect(authRedirectUrl(env, '/', 'invalid_issuer'), [clearTransaction]);
    }

    const endpoints = await discoverOidc(config);
    const tokens = await exchangeCode(config, endpoints, code, transaction.verifier);
    const idTokenUser = await verifyIdToken(config, endpoints, tokens.idToken, transaction.nonce);
    const userInfo = await fetchUserInfo(endpoints, tokens.accessToken);
    const user = mergeAuthUsers(idTokenUser, userInfo);
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
  if (!auditsEnabled(env)) {
    return json({ error: 'Audit submission is temporarily disabled.' }, 503);
  }

  const body = await readJsonObject(request);
  const normalized = normalizePublicUrl(body?.url);

  if (normalized.status === 'invalid') return json({ error: normalized.message }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const auditWindowDays = auditWindowDaysLimit(env);
  const windowStart = utcWindowStart(now, auditWindowDays);
  const userWindowLimit = userAuditWindowLimit(env);
  const globalWindowLimit = globalAuditWindowLimit(env);
  const activeLimit = globalActiveAuditLimit(env);

  const insert = await env.DB.prepare(
    `INSERT INTO audits (id, url, status, attempt, created_at, updated_at, owner_user_id, owner_email)
     SELECT ?, ?, 'queued', 0, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM audits WHERE owner_user_id = ? AND created_at >= ? AND NOT (status = 'cancelled' AND attempt = 0)) < ?
       AND (SELECT COUNT(*) FROM audits WHERE created_at >= ? AND NOT (status = 'cancelled' AND attempt = 0)) < ?
       AND (SELECT COUNT(*) FROM audits WHERE status IN ('queued', 'claimed', 'running', 'persisting')) < ?`,
  )
    .bind(
      id,
      normalized.url,
      now,
      now,
      session.user.id,
      session.user.email,
      session.user.id,
      windowStart,
      userWindowLimit,
      windowStart,
      globalWindowLimit,
      activeLimit,
    )
    .run();

  if (insert.meta?.changes !== 1) {
    return json(
      {
        error: 'Audit limit reached. This deployment is capped to control Cloudflare usage costs.',
        auditWindowDays,
        userWindowLimit,
        globalWindowLimit,
        globalActiveLimit: activeLimit,
      },
      429,
    );
  }

  const auditOptions = readAuditOptions(body?.options);
  const message: AuditJobMessage = { id, url: normalized.url, options: auditOptions };
  await env.AUDIT_QUEUE.send(message);

  return json({ id, status: 'queued' }, 202);
}

function readAuditOptions(value: unknown): NonNullable<AuditJobMessage['options']> {
  const record = isRecord(value) ? value : {};
  return {
    keyboard: typeof record.keyboard === 'boolean' ? record.keyboard : true,
    recommendations: typeof record.recommendations === 'boolean' ? record.recommendations : false,
    markupValidation:
      typeof record.markupValidation === 'boolean' ? record.markupValidation : false,
    aiReview: typeof record.aiReview === 'boolean' ? record.aiReview : false,
  };
}

async function listAudits(env: Env, session: AuthSession): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT ${AUDIT_COLUMNS} FROM audits WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(session.user.id, AUDIT_LIST_LIMIT)
    .all<AuditRow>();

  return json({ audits: results.map(toAuditJson) });
}

async function getAudit(id: string, env: Env, session: AuthSession): Promise<Response> {
  const row = await findAudit(id, env, session);
  if (row === null) return json({ error: 'Audit not found' }, 404);
  return json(toAuditJson(row));
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

async function cancelAudit(id: string, env: Env, session: AuthSession): Promise<Response> {
  const row = await findAudit(id, env, session);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  const next = nextState(row.status, 'cancel');
  if (next === null) {
    return json({ error: 'Audit cannot be cancelled from its current state' }, 409);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits SET status = ?, current_stage = NULL, last_error = 'Cancelled by user.', completed_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(next, now, now, id)
    .run();

  return json({ status: next });
}

async function deleteAudit(id: string, env: Env, session: AuthSession): Promise<Response> {
  const row = await findAudit(id, env, session);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  if (!isTerminalStatus(row.status)) {
    return json({ error: 'Cancel the audit before deleting it.' }, 409);
  }

  if (row.artifact_key !== null) await env.ARTIFACTS.delete(row.artifact_key);
  await env.DB.prepare(`DELETE FROM audits WHERE id = ?`).bind(id).run();

  return new Response(null, { status: 204 });
}

// --- Runner API: authenticated by ALLY_RUNNER_SECRET, never by a user session ---

type RunnerAction = 'claim' | 'running' | 'stage' | 'persisting' | 'complete' | 'fail';

const RUNNER_ACTIONS: ReadonlySet<string> = new Set<RunnerAction>([
  'claim',
  'running',
  'stage',
  'persisting',
  'complete',
  'fail',
]);

function isRunnerAction(value: string | undefined): value is RunnerAction {
  return value !== undefined && RUNNER_ACTIONS.has(value);
}

async function handleRunnerRoute(
  id: string,
  action: RunnerAction,
  request: Request,
  env: Env,
): Promise<Response> {
  switch (action) {
    case 'claim':
      return claimRunnerAudit(id, request, env);
    case 'running':
      return transitionRunnerAudit(id, env, 'start', (now) => ({
        query: `UPDATE audits SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`,
        values: (nextStatus) => [nextStatus, now, now, id],
      }));
    case 'stage':
      return reportRunnerStage(id, request, env);
    case 'persisting':
      return transitionRunnerAudit(id, env, 'persist', (now) => ({
        query: `UPDATE audits SET status = ?, updated_at = ? WHERE id = ?`,
        values: (nextStatus) => [nextStatus, now, id],
      }));
    case 'complete':
      return completeRunnerAudit(id, request, env);
    case 'fail':
      return failRunnerAudit(id, request, env);
  }
}

async function claimRunnerAudit(id: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const runnerId =
    typeof body?.runnerId === 'string' && body.runnerId !== '' ? body.runnerId : 'unknown-runner';

  const row = await findAuditById(id, env);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  if (isTerminalStatus(row.status)) {
    return json({ terminal: true, status: row.status, attempt: row.attempt });
  }

  const nextAttempt = row.attempt + 1;
  const maxAttempts = auditMaxAttempts(env);

  if (nextAttempt > maxAttempts) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE audits SET status = 'failed', attempt = ?, last_error = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(nextAttempt, 'Exceeded the maximum number of retry attempts.', now, now, id)
      .run();
    return json({ terminal: true, status: 'failed', attempt: nextAttempt });
  }

  const next = nextState(row.status, 'claim');
  if (next === null) return json({ error: 'Invalid state transition' }, 409);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits SET status = ?, attempt = ?, runner_id = ?, current_stage = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(next, nextAttempt, runnerId, now, id)
    .run();

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'job_claimed',
      auditId: id,
      attempt: nextAttempt,
      runnerId,
    }),
  );
  return json({ terminal: false, status: next, attempt: nextAttempt });
}

function transitionRunnerAudit(
  id: string,
  env: Env,
  event: AuditTransitionEvent,
  build: (now: string) => {
    query: string;
    values: (nextStatus: AuditStatus) => readonly unknown[];
  },
): Promise<Response> {
  return applyTransition(id, env, event, build);
}

async function applyTransition(
  id: string,
  env: Env,
  event: AuditTransitionEvent,
  build: (now: string) => {
    query: string;
    values: (nextStatus: AuditStatus) => readonly unknown[];
  },
): Promise<Response> {
  const row = await findAuditById(id, env);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  const next = nextState(row.status, event);
  if (next === null) return json({ error: 'Invalid state transition' }, 409);

  const now = new Date().toISOString();
  const { query, values } = build(now);
  await env.DB.prepare(query)
    .bind(...values(next))
    .run();

  return json({ status: next });
}

async function reportRunnerStage(id: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const stage = typeof body?.stage === 'string' ? body.stage : undefined;
  const status = typeof body?.status === 'string' ? body.status : undefined;
  if (stage === undefined || status === undefined) {
    return json({ error: 'stage and status are required' }, 400);
  }

  const row = await findAuditById(id, env);
  if (row === null) return json({ error: 'Audit not found' }, 404);
  if (isTerminalStatus(row.status)) return json({ status: row.status });

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE audits SET current_stage = ?, updated_at = ? WHERE id = ?`)
    .bind(`${stage}:${status}`, now, id)
    .run();

  return json({ ok: true });
}

async function reportContainerStage(
  id: string,
  env: Env,
  status: 'started' | 'ok' | 'failed',
  error?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits
     SET current_stage = ?, last_error = COALESCE(?, last_error), updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  )
    .bind(`container:${status}`, error ?? null, now, id)
    .run();
}

async function completeRunnerAudit(id: string, request: Request, env: Env): Promise<Response> {
  const row = await findAuditById(id, env);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  const next = nextState(row.status, 'complete');
  if (next === null) return json({ error: 'Invalid state transition' }, 409);

  const body = await readJsonObject(request);
  const result = isRecord(body?.result)
    ? await enrichResultWithWorkersAi(body.result, env)
    : undefined;
  const raw = isRecord(body?.raw) ? body.raw : {};
  if (result === undefined) return json({ error: 'result is required' }, 400);

  const artifactKey = `audits/${id}/audit.json`;
  await env.ARTIFACTS.put(artifactKey, serializeJson(result), {
    httpMetadata: { contentType: JSON_HEADERS['content-type'] },
  });

  for (const [engineId, rawOutput] of Object.entries(raw)) {
    await env.ARTIFACTS.put(`audits/${id}/raw/${rawFileName(engineId)}`, serializeJson(rawOutput), {
      httpMetadata: { contentType: JSON_HEADERS['content-type'] },
    });
  }

  const summary = summaryOf(result);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits
     SET status = 'completed', current_stage = NULL, completed_at = ?, updated_at = ?,
         score = ?, score_version = ?, unique_findings = ?, raw_findings = ?, keyboard_warnings = ?,
         engines_succeeded = ?, engines_configured = ?, engines_failed = ?, artifact_key = ?
     WHERE id = ?`,
  )
    .bind(
      now,
      now,
      summary.score,
      summary.scoreVersion,
      summary.uniqueFindings,
      summary.rawFindings,
      summary.keyboardWarnings,
      summary.enginesSucceeded,
      summary.enginesConfigured,
      summary.enginesFailed,
      artifactKey,
      id,
    )
    .run();

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'artifact_persisted',
      auditId: id,
      attempt: row.attempt,
    }),
  );
  return json({ status: 'completed' });
}

async function failRunnerAudit(id: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const category = typeof body?.category === 'string' ? body.category : 'internal';
  const message =
    typeof body?.message === 'string' && body.message !== '' ? body.message : 'The audit failed.';

  const row = await findAuditById(id, env);
  if (row === null) return json({ error: 'Audit not found' }, 404);

  const event: AuditTransitionEvent = category === 'audit-timeout' ? 'timeout' : 'fail';
  const next = nextState(row.status, event);
  if (next === null) return json({ error: 'Invalid state transition' }, 409);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE audits SET status = ?, current_stage = NULL, last_error = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(next, message, now, now, id)
    .run();

  console.warn(
    JSON.stringify({
      level: 'warn',
      message: 'audit_failed',
      auditId: id,
      attempt: row.attempt,
      category,
    }),
  );
  return json({ status: next });
}

interface RunnerSummary {
  readonly score: number | null;
  readonly scoreVersion: number | null;
  readonly uniqueFindings: number | null;
  readonly rawFindings: number | null;
  readonly keyboardWarnings: number | null;
  readonly enginesSucceeded: number | null;
  readonly enginesConfigured: number | null;
  readonly enginesFailed: number | null;
}

function summaryOf(result: Record<string, unknown>): RunnerSummary {
  const score = isRecord(result.score) ? result.score : undefined;
  const summary = isRecord(result.summary) ? result.summary : undefined;
  const coverage = isRecord(result.coverage) ? result.coverage : undefined;
  const keyboard = isRecord(summary?.keyboard) ? summary.keyboard : undefined;

  return {
    score: numberOrNull(score?.value),
    scoreVersion: numberOrNull(score?.version),
    uniqueFindings: numberOrNull(summary?.uniqueFindings),
    rawFindings: numberOrNull(summary?.totalFindings),
    keyboardWarnings: numberOrNull(keyboard?.anomalies),
    enginesSucceeded: numberOrNull(coverage?.enginesSucceeded),
    enginesConfigured: numberOrNull(coverage?.enginesConfigured),
    enginesFailed: numberOrNull(summary?.enginesFailed),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function auditMaxAttempts(env: Env): number {
  const parsed = Number(env.AUDIT_MAX_ATTEMPTS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ATTEMPTS;
}

function auditsEnabled(env: Env): boolean {
  return env.AUDITS_ENABLED?.trim().toLowerCase() !== 'false';
}

function auditWindowDaysLimit(env: Env): number {
  return positiveInteger(env.ALLY_AUDIT_WINDOW_DAYS, DEFAULT_AUDIT_WINDOW_DAYS);
}

function userAuditWindowLimit(env: Env): number {
  return positiveInteger(env.ALLY_USER_AUDIT_WINDOW_LIMIT, DEFAULT_USER_AUDIT_WINDOW_LIMIT);
}

function globalAuditWindowLimit(env: Env): number {
  return positiveInteger(env.ALLY_GLOBAL_AUDIT_WINDOW_LIMIT, DEFAULT_GLOBAL_AUDIT_WINDOW_LIMIT);
}

function globalActiveAuditLimit(env: Env): number {
  return positiveInteger(env.ALLY_GLOBAL_ACTIVE_AUDIT_LIMIT, DEFAULT_GLOBAL_ACTIVE_AUDIT_LIMIT);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utcWindowStart(isoTimestamp: string, days: number): string {
  const timestamp = Date.parse(isoTimestamp);
  const windowMs = days * 24 * 60 * 60 * 1000;
  return new Date(timestamp - windowMs).toISOString();
}

// --- Compatibility spike: unrelated to the job queue, still uses Browser Run directly ---

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

// --- Shared helpers ---

function normalizePublicUrl(
  value: unknown,
):
  | { readonly status: 'ok'; readonly url: string }
  | { readonly status: 'invalid'; readonly message: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { status: 'invalid', message: 'Provide a URL.' };
  }

  try {
    const url = assertSyntacticallyPublicUrl(value);
    return { status: 'ok', url: url.toString() };
  } catch (error) {
    if (error instanceof SsrfBlockedError) return { status: 'invalid', message: error.message };
    return { status: 'invalid', message: 'Provide a valid absolute URL.' };
  }
}

async function findAudit(id: string, env: Env, session: AuthSession): Promise<AuditRow | null> {
  return env.DB.prepare(`SELECT ${AUDIT_COLUMNS} FROM audits WHERE id = ? AND owner_user_id = ?`)
    .bind(id, session.user.id)
    .first<AuditRow>();
}

async function findAuditById(id: string, env: Env): Promise<AuditRow | null> {
  return env.DB.prepare(`SELECT ${AUDIT_COLUMNS} FROM audits WHERE id = ?`)
    .bind(id)
    .first<AuditRow>();
}

function toAuditJson(row: AuditRow): Record<string, unknown> {
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    currentStage: row.current_stage,
    attempt: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    summary:
      row.status === 'completed'
        ? {
            score: row.score,
            scoreVersion: row.score_version,
            uniqueFindings: row.unique_findings,
            rawFindings: row.raw_findings,
            keyboardWarnings: row.keyboard_warnings,
            enginesSucceeded: row.engines_succeeded,
            enginesConfigured: row.engines_configured,
            enginesFailed: row.engines_failed,
          }
        : undefined,
    resultUrl: row.status === 'completed' ? `/api/audits/${row.id}/result` : undefined,
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const body: unknown = await request.json().catch(() => undefined);
  return isRecord(body) ? body : undefined;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  headers.set('access-control-allow-origin', allowedOrigin(origin, env));
  headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
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
    // The Pages project's default domain, live until/alongside the custom
    // domain configured via PUBLIC_WEB_ORIGIN.
    'https://ally-audit-web.pages.dev',
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

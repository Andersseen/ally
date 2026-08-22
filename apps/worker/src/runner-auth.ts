import { constantTimeEqual } from './auth.js';

/**
 * Machine-to-machine trust between the Worker and the standalone Node
 * runner. Deliberately separate from `auth.ts`'s DevAuth session logic —
 * the runner is not a user, must never go through the OIDC flow, and this
 * secret must be rotatable independently of any user session.
 */
export interface RunnerAuthEnv {
  readonly ALLY_RUNNER_SECRET?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function runnerAuthIsConfigured(env: RunnerAuthEnv): boolean {
  return runnerSecretValue(env) !== undefined;
}

/**
 * Verifies the `Authorization: Bearer <secret>` header on a `/api/runner/*`
 * request. Returns `true` when authorized, or the `Response` to send back
 * otherwise — fails closed: an unset secret rejects every request rather
 * than allowing them through.
 */
export function requireRunnerAuth(request: Request, env: RunnerAuthEnv): true | Response {
  const secret = runnerSecretValue(env);
  if (secret === undefined) {
    return json({ error: 'Runner authentication is not configured' }, 503);
  }

  const token = bearerToken(request.headers.get('authorization'));
  if (token === undefined || !constantTimeEqual(token, secret)) {
    return json({ error: 'Runner authentication required' }, 401);
  }

  return true;
}

function bearerToken(header: string | null): string | undefined {
  if (header === null || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? undefined : token;
}

function runnerSecretValue(env: RunnerAuthEnv): string | undefined {
  const value = env.ALLY_RUNNER_SECRET;
  return value === undefined || value.trim() === '' ? undefined : value;
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

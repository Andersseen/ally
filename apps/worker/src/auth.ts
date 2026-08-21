const OAUTH_TRANSACTION_COOKIE = 'ally_oauth_tx';
const SESSION_COOKIE = 'ally_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthEnv {
  readonly DEV_AUTH_URL?: string;
  readonly DEV_AUTH_CLIENT_ID?: string;
  readonly DEV_AUTH_CLIENT_SECRET?: string;
  readonly DEV_AUTH_REDIRECT_URI?: string;
  readonly ALLY_SESSION_SECRET?: string;
  readonly PUBLIC_WEB_ORIGIN?: string;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly expiresAt: string;
}

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
}

interface OAuthTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly returnTo: string;
}

interface UserInfo {
  readonly sub?: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
  readonly image?: string;
}

interface TokenResponse {
  readonly access_token?: string;
}

export class AuthConfigurationError extends Error {}
export class OidcError extends Error {}

export function resolveOidcConfig(env: AuthEnv): OidcConfig {
  const config: OidcConfig = {
    issuer: (env.DEV_AUTH_URL ?? 'https://auth-devflare.andersseen.dev').replace(/\/$/, ''),
    clientId: env.DEV_AUTH_CLIENT_ID ?? 'ally-dev',
    redirectUri: env.DEV_AUTH_REDIRECT_URI ?? 'http://127.0.0.1:8787/api/auth/callback',
  };
  return env.DEV_AUTH_CLIENT_SECRET === undefined
    ? config
    : { ...config, clientSecret: env.DEV_AUTH_CLIENT_SECRET };
}

export function webOrigin(env: AuthEnv): string {
  return (env.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

export function createLoginTransaction(returnTo: string): OAuthTransaction {
  return {
    state: randomToken(),
    verifier: randomToken(),
    returnTo: safeReturnTo(returnTo),
  };
}

export async function authorizationUrl(config: OidcConfig, transaction: OAuthTransaction): Promise<string> {
  const url = new URL(`${config.issuer}/api/auth/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state: transaction.state,
    nonce: randomToken(),
    code_challenge: await codeChallenge(transaction.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function transactionCookie(transaction: OAuthTransaction, secure: boolean): string {
  return serializeCookie(OAUTH_TRANSACTION_COOKIE, encodeURIComponent(JSON.stringify(transaction)), {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: 10 * 60,
  });
}

export function readTransaction(cookieHeader: string | null | undefined): OAuthTransaction | null {
  const raw = readCookie(cookieHeader, OAUTH_TRANSACTION_COOKIE);
  if (raw === undefined) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<OAuthTransaction>;
    if (typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string') return null;
    return {
      state: parsed.state,
      verifier: parsed.verifier,
      returnTo: safeReturnTo(parsed.returnTo),
    };
  } catch {
    return null;
  }
}

export function clearTransactionCookie(): string {
  return expiredCookie(OAUTH_TRANSACTION_COOKIE);
}

export async function exchangeCode(
  config: OidcConfig,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);

  const response = await fetch(`${config.issuer}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    console.error(`[auth] token exchange failed (${response.status}): ${await response.text()}`);
    throw new OidcError('provider_token_exchange_failed');
  }

  const token = (await response.json()) as TokenResponse;
  if (typeof token.access_token !== 'string' || token.access_token === '') {
    throw new OidcError('provider_returned_no_access_token');
  }
  return token.access_token;
}

export async function fetchUserInfo(config: OidcConfig, accessToken: string): Promise<AuthUser> {
  const response = await fetch(`${config.issuer}/api/auth/oauth2/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error(`[auth] userinfo failed (${response.status}): ${await response.text()}`);
    throw new OidcError('provider_userinfo_failed');
  }

  const info = (await response.json()) as UserInfo;
  if (typeof info.sub !== 'string' || info.sub === '') {
    throw new OidcError('provider_returned_no_subject');
  }

  return {
    id: info.sub,
    email: info.email ?? '',
    name: info.name || info.email || 'Ally user',
    image: info.picture ?? info.image ?? null,
  };
}

export async function sessionCookie(user: AuthUser, env: AuthEnv, secure: boolean): Promise<string> {
  const secret = sessionSecret(env);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ user, expiresAt } satisfies AuthSession)),
  );
  const signature = await sign(payload, secret);
  return serializeCookie(SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(
  cookieHeader: string | null | undefined,
  env: AuthEnv,
): Promise<AuthSession | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token === undefined) return null;

  const [payload, signature] = token.split('.');
  if (payload === undefined || signature === undefined) return null;

  const expected = await sign(payload, sessionSecret(env));
  if (signature !== expected) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as AuthSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSessionCookie(): string {
  return expiredCookie(SESSION_COOKIE);
}

export function authIsConfigured(env: AuthEnv): boolean {
  return sessionSecretValue(env) !== undefined;
}

function sessionSecret(env: AuthEnv): string {
  const secret = sessionSecretValue(env);
  if (secret === undefined) {
    throw new AuthConfigurationError('ALLY_SESSION_SECRET or DEV_AUTH_CLIENT_SECRET is required');
  }
  return secret;
}

function sessionSecretValue(env: AuthEnv): string | undefined {
  return env.ALLY_SESSION_SECRET ?? env.DEV_AUTH_CLIENT_SECRET;
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=');
  }
  return undefined;
}

interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly sameSite?: 'Lax' | 'Strict' | 'None';
  readonly secure?: boolean;
  readonly path?: string;
  readonly maxAge?: number;
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${String(options.maxAge)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function expiredCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

const OAUTH_TRANSACTION_COOKIE = 'ally_oauth_tx';
const SESSION_COOKIE = 'ally_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

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
  readonly nonce: string;
  readonly returnTo: string;
}

export interface OidcEndpoints {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly userInfoEndpoint?: string;
}

export interface TokenResponse {
  readonly accessToken: string;
  readonly idToken: string;
}

interface OidcJsonWebKey extends JsonWebKey {
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
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
    nonce: randomToken(),
    returnTo: safeReturnTo(returnTo),
  };
}

export async function authorizationUrl(config: OidcConfig, transaction: OAuthTransaction): Promise<string> {
  const endpoints = await discoverOidc(config);
  const url = new URL(endpoints.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state: transaction.state,
    nonce: transaction.nonce,
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
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.nonce !== 'string'
    ) {
      return null;
    }
    return {
      state: parsed.state,
      verifier: parsed.verifier,
      nonce: parsed.nonce,
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
  endpoints: OidcEndpoints,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);

  const response = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    console.error(`[auth] token exchange failed (${response.status})`);
    throw new OidcError('provider_token_exchange_failed');
  }

  return parseTokenResponse(await response.json());
}

export async function fetchUserInfo(
  endpoints: OidcEndpoints,
  accessToken: string,
): Promise<AuthUser> {
  if (endpoints.userInfoEndpoint === undefined) {
    throw new OidcError('provider_has_no_userinfo_endpoint');
  }

  const response = await fetch(endpoints.userInfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error(`[auth] userinfo failed (${response.status})`);
    throw new OidcError('provider_userinfo_failed');
  }

  return authUserFromClaims(await response.json(), 'provider_returned_no_subject');
}

export async function verifyIdToken(
  config: OidcConfig,
  endpoints: OidcEndpoints,
  idToken: string,
  expectedNonce: string,
): Promise<AuthUser> {
  return verifyIdTokenWithJwks(
    config,
    await fetchJwks(endpoints.jwksUri),
    idToken,
    expectedNonce,
  );
}

export async function verifyIdTokenWithJwks(
  config: OidcConfig,
  jwks: readonly OidcJsonWebKey[],
  idToken: string,
  expectedNonce: string,
): Promise<AuthUser> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('provider_id_token_malformed');

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined
  ) {
    throw new OidcError('provider_id_token_malformed');
  }

  const header = parseJwtHeader(encodedHeader);
  if (header.alg !== 'ES256') throw new OidcError('provider_id_token_alg_rejected');

  const key = selectJwk(jwks, header.kid);
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signature = base64UrlDecode(encodedSignature);
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    toArrayBuffer(signature),
    toArrayBuffer(signed),
  );

  if (!verified) throw new OidcError('provider_id_token_signature_invalid');

  const claims = parseJwtClaims(encodedClaims);
  validateIdTokenClaims(config, claims, expectedNonce);
  return authUserFromClaims(claims, 'provider_id_token_missing_subject');
}

export async function discoverOidc(config: OidcConfig): Promise<OidcEndpoints> {
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`);

  if (!response.ok) {
    console.error(`[auth] discovery failed (${response.status})`);
    throw new OidcError('provider_discovery_failed');
  }

  const value: unknown = await response.json();
  if (!isRecord(value)) throw new OidcError('provider_discovery_invalid');

  const issuer = stringField(value, 'issuer');
  if (issuer !== config.issuer) throw new OidcError('provider_issuer_mismatch');

  const authorizationEndpoint = stringField(value, 'authorization_endpoint');
  const tokenEndpoint = stringField(value, 'token_endpoint');
  const jwksUri = stringField(value, 'jwks_uri');
  const rawUserInfoEndpoint = value.userinfo_endpoint;

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    ...(typeof rawUserInfoEndpoint === 'string'
      ? { userInfoEndpoint: rawUserInfoEndpoint }
      : {}),
  };
}

export function validateCallbackIssuer(issuer: string | null, config: OidcConfig): boolean {
  return issuer === config.issuer;
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!isRecord(value)) throw new OidcError('provider_token_response_invalid');

  const accessToken = value.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new OidcError('provider_returned_no_access_token');
  }

  const idToken = value.id_token;
  if (typeof idToken !== 'string' || idToken === '') {
    throw new OidcError('provider_returned_no_id_token');
  }

  return { accessToken, idToken };
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

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  if (payload === undefined || signature === undefined || payload === '' || signature === '') {
    return null;
  }

  const expected = await sign(payload, sessionSecret(env));
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const session = parseAuthSession(
      JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))),
    );
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
  return authMissingConfiguration(env).length === 0;
}

export function authMissingConfiguration(env: AuthEnv): readonly string[] {
  const missing: string[] = [];
  if (sessionSecretValue(env) === undefined) missing.push('ALLY_SESSION_SECRET');
  if (clientSecretValue(env) === undefined) missing.push('DEV_AUTH_CLIENT_SECRET');
  return missing;
}

function sessionSecret(env: AuthEnv): string {
  const secret = sessionSecretValue(env);
  if (secret === undefined) {
    throw new AuthConfigurationError('ALLY_SESSION_SECRET is required');
  }
  return secret;
}

function sessionSecretValue(env: AuthEnv): string | undefined {
  return emptyToUndefined(env.ALLY_SESSION_SECRET);
}

function clientSecretValue(env: AuthEnv): string | undefined {
  return emptyToUndefined(env.DEV_AUTH_CLIENT_SECRET);
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
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

async function fetchJwks(jwksUri: string): Promise<readonly OidcJsonWebKey[]> {
  const response = await fetch(jwksUri);
  if (!response.ok) {
    console.error(`[auth] jwks failed (${response.status})`);
    throw new OidcError('provider_jwks_failed');
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new OidcError('provider_jwks_invalid');
  }
  return value.keys.filter(isJsonWebKey);
}

function parseJwtHeader(encodedHeader: string): { readonly alg: string; readonly kid?: string } {
  const header = parseBase64UrlJson(encodedHeader);
  if (!isRecord(header) || typeof header.alg !== 'string') {
    throw new OidcError('provider_id_token_header_invalid');
  }
  return {
    alg: header.alg,
    ...(typeof header.kid === 'string' ? { kid: header.kid } : {}),
  };
}

function parseJwtClaims(encodedClaims: string): Record<string, unknown> {
  const claims = parseBase64UrlJson(encodedClaims);
  if (!isRecord(claims)) throw new OidcError('provider_id_token_claims_invalid');
  return claims;
}

function parseBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
  } catch {
    throw new OidcError('provider_id_token_malformed');
  }
}

function selectJwk(jwks: readonly OidcJsonWebKey[], kid: string | undefined): OidcJsonWebKey {
  const key = jwks.find((candidate) => {
    if (candidate.kty !== 'EC' || candidate.crv !== 'P-256') return false;
    return kid === undefined || candidate.kid === kid;
  });

  if (key === undefined) throw new OidcError('provider_id_token_key_not_found');
  return key;
}

function validateIdTokenClaims(
  config: OidcConfig,
  claims: Record<string, unknown>,
  expectedNonce: string,
): void {
  if (claims.iss !== config.issuer) throw new OidcError('provider_id_token_issuer_invalid');
  if (!audienceIncludes(claims.aud, config.clientId)) {
    throw new OidcError('provider_id_token_audience_invalid');
  }

  if (typeof claims.exp !== 'number') throw new OidcError('provider_id_token_exp_invalid');
  const nowSeconds = Date.now() / 1000;
  if (claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new OidcError('provider_id_token_expired');
  }

  if (claims.nonce !== expectedNonce) throw new OidcError('provider_id_token_nonce_invalid');
}

function audienceIncludes(audience: unknown, clientId: string): boolean {
  if (typeof audience === 'string') return audience === clientId;
  return Array.isArray(audience) && audience.every((value) => typeof value === 'string')
    ? audience.includes(clientId)
    : false;
}

function authUserFromClaims(value: unknown, missingSubjectError: string): AuthUser {
  if (!isRecord(value) || typeof value.sub !== 'string' || value.sub === '') {
    throw new OidcError(missingSubjectError);
  }

  const email = typeof value.email === 'string' ? value.email : '';
  const name =
    typeof value.name === 'string' && value.name !== ''
      ? value.name
      : email || 'Ally user';
  const picture = typeof value.picture === 'string' ? value.picture : undefined;
  const image = typeof value.image === 'string' ? value.image : undefined;

  return {
    id: value.sub,
    email,
    name,
    image: picture ?? image ?? null,
  };
}

export function mergeAuthUsers(primary: AuthUser, userInfo: AuthUser): AuthUser {
  if (userInfo.id !== primary.id) throw new OidcError('provider_userinfo_subject_mismatch');
  return {
    id: primary.id,
    email: userInfo.email || primary.email,
    name: userInfo.name || primary.name,
    image: userInfo.image ?? primary.image,
  };
}

function parseAuthSession(value: unknown): AuthSession {
  if (!isRecord(value) || !isRecord(value.user) || typeof value.expiresAt !== 'string') {
    throw new Error('invalid_session');
  }

  const user = value.user;
  if (
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    typeof user.name !== 'string' ||
    !(typeof user.image === 'string' || user.image === null)
  ) {
    throw new Error('invalid_session');
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
    expiresAt: value.expiresAt,
  };
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field === '') {
    throw new OidcError('provider_discovery_invalid');
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonWebKey(value: unknown): value is OidcJsonWebKey {
  return isRecord(value) && typeof value.kty === 'string';
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
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

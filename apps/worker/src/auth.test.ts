import { describe, expect, test } from 'vitest';
import {
  authIsConfigured,
  readSession,
  safeReturnTo,
  sessionCookie,
  verifyIdTokenWithJwks,
} from './auth.js';
import type { AuthUser, OidcConfig } from './auth.js';

const CONFIG: OidcConfig = {
  issuer: 'https://auth-devflare.andersseen.dev',
  clientId: 'ally-dev',
  clientSecret: 'client-secret',
  redirectUri: 'https://ally.andersseen.dev/api/auth/callback',
};

describe('auth configuration', () => {
  test('requires separate client and session secrets', () => {
    expect(authIsConfigured({ ALLY_SESSION_SECRET: 'session-secret' })).toBe(false);
    expect(authIsConfigured({ DEV_AUTH_CLIENT_SECRET: 'client-secret' })).toBe(false);
    expect(
      authIsConfigured({
        DEV_AUTH_CLIENT_SECRET: 'client-secret',
        ALLY_SESSION_SECRET: 'session-secret',
      }),
    ).toBe(true);
  });
});

describe('safeReturnTo', () => {
  test('keeps same-site paths and rejects off-site redirects', () => {
    expect(safeReturnTo('/dashboard')).toBe('/dashboard');
    expect(safeReturnTo('https://evil.example/dashboard')).toBe('/');
    expect(safeReturnTo('//evil.example/dashboard')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});

describe('Ally session cookie', () => {
  test('round-trips a signed app session and rejects tampering', async () => {
    const env = { ALLY_SESSION_SECRET: 'session-secret' };
    const user: AuthUser = {
      id: 'user_123',
      email: 'andriipap01@gmail.com',
      name: 'Andrii',
      image: null,
    };

    const cookie = await sessionCookie(user, env, true);
    const session = await readSession(cookie, env);
    expect(session?.user).toEqual(user);

    const value = cookieValue(cookie, 'ally_session');
    const tamperedValue = `${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`;
    await expect(readSession(`ally_session=${tamperedValue}`, env)).resolves.toBeNull();
  });
});

describe('ID token verification', () => {
  test('verifies ES256 ID tokens and validates nonce', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const jwk = await publicJwk(keyPair.publicKey, 'test-key');
    const claims = {
      iss: CONFIG.issuer,
      aud: CONFIG.clientId,
      sub: 'dev-auth-user',
      email: 'andriipap01@gmail.com',
      name: 'Andrii',
      picture: 'https://example.com/avatar.png',
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: 'expected-nonce',
    };
    const jwt = await signJwt(keyPair.privateKey, 'test-key', claims);

    await expect(
      verifyIdTokenWithJwks(CONFIG, [jwk], jwt, 'expected-nonce'),
    ).resolves.toEqual({
      id: 'dev-auth-user',
      email: 'andriipap01@gmail.com',
      name: 'Andrii',
      image: 'https://example.com/avatar.png',
    });

    await expect(
      verifyIdTokenWithJwks(CONFIG, [jwk], jwt, 'wrong-nonce'),
    ).rejects.toThrow('provider_id_token_nonce_invalid');
  });
});

function cookieValue(cookie: string, name: string): string {
  const prefix = `${name}=`;
  const part = cookie.split(';').find((candidate) => candidate.trim().startsWith(prefix));
  if (part === undefined) throw new Error(`Missing cookie ${name}`);
  return part.trim().slice(prefix.length);
}

async function publicJwk(
  publicKey: CryptoKey,
  kid: string,
): Promise<JsonWebKey & { readonly kid: string; readonly alg: string; readonly use: string }> {
  return {
    ...(await crypto.subtle.exportKey('jwk', publicKey)),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
}

async function signJwt(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = base64UrlJson({ alg: 'ES256', typ: 'JWT', kid });
  const payload = base64UrlJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

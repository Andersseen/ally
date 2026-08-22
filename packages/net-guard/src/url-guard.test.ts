import { describe, expect, test } from 'vitest';
import { SsrfBlockedError } from './errors.js';
import { assertSyntacticallyPublicUrl } from './url-guard.js';

function reasonOf(fn: () => unknown): string {
  try {
    fn();
    throw new Error('expected assertSyntacticallyPublicUrl to throw');
  } catch (error) {
    if (error instanceof SsrfBlockedError) return error.reason;
    throw error;
  }
}

describe('assertSyntacticallyPublicUrl', () => {
  test('accepts ordinary public http(s) URLs', () => {
    expect(assertSyntacticallyPublicUrl('https://example.com/page').toString()).toBe(
      'https://example.com/page',
    );
    expect(assertSyntacticallyPublicUrl('http://example.com').toString()).toBe(
      'http://example.com/',
    );
  });

  test('strips the fragment', () => {
    expect(assertSyntacticallyPublicUrl('https://example.com/#section').hash).toBe('');
  });

  test('rejects empty and unparsable input', () => {
    expect(reasonOf(() => assertSyntacticallyPublicUrl(''))).toBe('invalid-url');
    expect(reasonOf(() => assertSyntacticallyPublicUrl('   '))).toBe('invalid-url');
    expect(reasonOf(() => assertSyntacticallyPublicUrl('not a url'))).toBe('invalid-url');
  });

  test('rejects non-http(s) protocols', () => {
    expect(reasonOf(() => assertSyntacticallyPublicUrl('ftp://example.com'))).toBe(
      'unsupported-protocol',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('file:///etc/passwd'))).toBe(
      'unsupported-protocol',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('javascript:alert(1)'))).toBe(
      'unsupported-protocol',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('gopher://example.com'))).toBe(
      'unsupported-protocol',
    );
  });

  test('rejects embedded credentials', () => {
    expect(reasonOf(() => assertSyntacticallyPublicUrl('https://user:pass@example.com'))).toBe(
      'credentials-in-url',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('https://user@example.com'))).toBe(
      'credentials-in-url',
    );
  });

  test('rejects loopback and private literals', () => {
    for (const url of [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://127.0.0.1:8787/',
      'http://[::1]/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/', // cloud metadata
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(
        reasonOf(() => assertSyntacticallyPublicUrl(url)),
        url,
      ).toBe('private-network-address');
    }
  });

  test('rejects decimal/hex/octal IPv4 obfuscation, via URL canonicalization', () => {
    for (const url of [
      'http://2130706433/', // decimal for 127.0.0.1
      'http://0x7f000001/', // hex for 127.0.0.1
      'http://017700000001/', // octal for 127.0.0.1
      'http://127.1/', // shorthand for 127.0.0.1
      'http://0177.0.0.1/', // octal first octet
    ]) {
      expect(
        reasonOf(() => assertSyntacticallyPublicUrl(url)),
        url,
      ).toBe('private-network-address');
    }
  });

  test('rejects mDNS-style and internal TLDs', () => {
    expect(reasonOf(() => assertSyntacticallyPublicUrl('http://printer.local/'))).toBe(
      'private-network-address',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('http://service.internal/'))).toBe(
      'private-network-address',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('http://LOCALHOST/'))).toBe(
      'private-network-address',
    );
    expect(reasonOf(() => assertSyntacticallyPublicUrl('http://localhost./'))).toBe(
      'private-network-address',
    );
  });

  test('does not block ordinary hostnames that merely contain "local"', () => {
    expect(assertSyntacticallyPublicUrl('https://locally.example.com').hostname).toBe(
      'locally.example.com',
    );
  });

  describe('allowHostnames', () => {
    test('exempts an exact host:port match from the private-network check', () => {
      const url = assertSyntacticallyPublicUrl('http://127.0.0.1:4173/', {
        allowHostnames: new Set(['127.0.0.1:4173']),
      });
      expect(url.host).toBe('127.0.0.1:4173');
    });

    test('does not exempt a different port on the same allowlisted host', () => {
      expect(() =>
        assertSyntacticallyPublicUrl('http://127.0.0.1:9999/', {
          allowHostnames: new Set(['127.0.0.1:4173']),
        }),
      ).toThrow(SsrfBlockedError);
    });

    test('does not exempt an unrelated private host', () => {
      expect(() =>
        assertSyntacticallyPublicUrl('http://10.0.0.5/', {
          allowHostnames: new Set(['127.0.0.1:4173']),
        }),
      ).toThrow(SsrfBlockedError);
    });

    test('still rejects credentials and bad protocols on an allowlisted host', () => {
      const allowHostnames = new Set(['127.0.0.1:4173']);
      expect(() =>
        assertSyntacticallyPublicUrl('http://user:pass@127.0.0.1:4173/', { allowHostnames }),
      ).toThrow(SsrfBlockedError);
      expect(() =>
        assertSyntacticallyPublicUrl('ftp://127.0.0.1:4173/', { allowHostnames }),
      ).toThrow(SsrfBlockedError);
    });
  });
});

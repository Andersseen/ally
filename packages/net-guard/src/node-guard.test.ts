import { describe, expect, test } from 'vitest';
import { SsrfBlockedError } from './errors.js';
import { assertPublicUrl } from './node-guard.js';

function fakeResolver(addresses: Record<string, readonly string[]>) {
  return (hostname: string): Promise<readonly string[]> => {
    const resolved = addresses[hostname];
    return resolved === undefined
      ? Promise.reject(new Error(`no fake DNS entry for ${hostname}`))
      : Promise.resolve(resolved);
  };
}

describe('assertPublicUrl', () => {
  test('allows a hostname that resolves to public addresses', async () => {
    const resolve = fakeResolver({ 'example.com': ['93.184.216.34'] });
    const url = await assertPublicUrl('https://example.com/page', { resolve });
    expect(url.toString()).toBe('https://example.com/page');
  });

  test('blocks a public-looking hostname that resolves to a private address', async () => {
    const resolve = fakeResolver({ 'rebind.example.com': ['127.0.0.1'] });
    await expect(assertPublicUrl('https://rebind.example.com/', { resolve })).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  test('blocks when any resolved address (not just the first) is private', async () => {
    const resolve = fakeResolver({ 'multi.example.com': ['93.184.216.34', '169.254.169.254'] });
    await expect(assertPublicUrl('https://multi.example.com/', { resolve })).rejects.toMatchObject({
      reason: 'private-network-address',
    });
  });

  test('fails closed when DNS resolution throws', async () => {
    const resolve = (): Promise<readonly string[]> => Promise.reject(new Error('ENOTFOUND'));
    await expect(
      assertPublicUrl('https://does-not-resolve.example.com/', { resolve }),
    ).rejects.toMatchObject({ reason: 'dns-resolution-failed' });
  });

  test('fails closed when DNS resolution returns no addresses', async () => {
    const resolve = fakeResolver({ 'empty.example.com': [] });
    await expect(assertPublicUrl('https://empty.example.com/', { resolve })).rejects.toMatchObject({
      reason: 'dns-resolution-failed',
    });
  });

  test('still rejects a literal private URL before ever resolving DNS', async () => {
    const resolve = (): Promise<readonly string[]> => {
      throw new Error('should not be called');
    };
    await expect(assertPublicUrl('http://127.0.0.1/', { resolve })).rejects.toMatchObject({
      reason: 'private-network-address',
    });
  });

  test('an allowlisted loopback host skips DNS resolution entirely', async () => {
    const resolve = (): Promise<readonly string[]> => {
      throw new Error('should not be called for an allowlisted host');
    };
    const url = await assertPublicUrl('http://127.0.0.1:4173/report', {
      resolve,
      allowHostnames: new Set(['127.0.0.1:4173']),
    });
    expect(url.host).toBe('127.0.0.1:4173');
  });
});

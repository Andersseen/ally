import { SsrfBlockedError } from './errors.js';
import { isPrivateOrReservedHostname } from './hostname.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export interface UrlGuardOptions {
  /**
   * Exact `host` values (hostname, or `hostname:port`) exempted from the
   * private/reserved-address check. Empty by default — this exists for a
   * deliberately configured exception (an operator's own internal target,
   * or a test fixture server), never as a general bypass. Protocol and
   * credential checks still apply to an allowlisted host.
   */
  readonly allowHostnames?: ReadonlySet<string>;
}

/**
 * Syntactic-only SSRF check: valid absolute http(s) URL, no embedded
 * credentials, and not a literal private/loopback/link-local/reserved
 * address or a `.local`/`.internal`/`localhost` name.
 *
 * This is the check a Cloudflare Worker can run (no DNS resolution
 * available). It is also the first thing the Node runner runs, before
 * spending the cost of opening a browser — the full check with DNS
 * resolution is `assertPublicUrl` in `@ally/net-guard/node`.
 *
 * Fails closed: any parse ambiguity is treated as blocked, never allowed.
 */
export function assertSyntacticallyPublicUrl(input: string, options: UrlGuardOptions = {}): URL {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new SsrfBlockedError('invalid-url', 'Provide a URL.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (cause) {
    throw new SsrfBlockedError('invalid-url', 'Provide a valid absolute URL.', { cause });
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(
      'unsupported-protocol',
      'Only http:// and https:// URLs can be audited.',
    );
  }

  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('credentials-in-url', 'Credentials in URLs are not accepted.');
  }

  const isAllowlisted = options.allowHostnames?.has(url.host) ?? false;
  if (!isAllowlisted && isPrivateOrReservedHostname(url.hostname)) {
    throw new SsrfBlockedError(
      'private-network-address',
      'The target resolved to a private or reserved network address and cannot be audited.',
    );
  }

  url.hash = '';
  return url;
}

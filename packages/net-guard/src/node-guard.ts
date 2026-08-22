import { resolveAllAddresses } from './dns.js';
import { SsrfBlockedError } from './errors.js';
import { isBlockedIpAddress } from './ip-ranges.js';
import { assertSyntacticallyPublicUrl } from './url-guard.js';
import type { UrlGuardOptions } from './url-guard.js';

export interface AssertPublicUrlOptions extends UrlGuardOptions {
  /**
   * Overrides DNS resolution. Tests inject a fake resolver here so the SSRF
   * suite never touches the network; the Node runner uses the default.
   */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
}

/**
 * The full SSRF check: syntax (see `assertSyntacticallyPublicUrl`) plus DNS
 * resolution, with every resolved address checked against the same
 * private/reserved ranges.
 *
 * This is what actually protects the hosted service — it is what the Node
 * runner calls before the first navigation and again for every redirect
 * target, because a public-looking hostname can still resolve to a private
 * address (including via DNS rebinding between requests). A resolution
 * failure is treated as blocked, not as "assume it's fine": SSRF checks fail
 * closed.
 */
export async function assertPublicUrl(
  input: string,
  options: AssertPublicUrlOptions = {},
): Promise<URL> {
  const resolve = options.resolve ?? resolveAllAddresses;
  const url = assertSyntacticallyPublicUrl(input, options);

  if (options.allowHostnames?.has(url.host) ?? false) return url;

  let addresses: readonly string[];
  try {
    addresses = await resolve(url.hostname);
  } catch (cause) {
    throw new SsrfBlockedError('dns-resolution-failed', `Could not resolve ${url.hostname}.`, {
      cause,
    });
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      'dns-resolution-failed',
      `${url.hostname} did not resolve to any address.`,
    );
  }

  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new SsrfBlockedError(
        'private-network-address',
        'The target resolved to a private or reserved network address and cannot be audited.',
      );
    }
  }

  return url;
}

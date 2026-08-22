/**
 * Portable SSRF checks: safe to import from a Cloudflare Worker or from
 * Node. No `node:dns`/`node:net` and no Playwright — those live behind the
 * `@ally/net-guard/node` entry, which needs a runtime that can resolve DNS
 * and drive a browser.
 */
export { SsrfBlockedError } from './errors.js';
export type { SsrfBlockReason } from './errors.js';
export { isPrivateOrReservedHostname } from './hostname.js';
export {
  isBlockedIpAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedIPv6Groups,
  parseIPv4,
  parseIPv6,
} from './ip-ranges.js';
export { assertSyntacticallyPublicUrl } from './url-guard.js';

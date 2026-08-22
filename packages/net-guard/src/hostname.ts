import { isBlockedIpAddress } from './ip-ranges.js';

const BLOCKED_EXACT = new Set(['localhost', 'local', 'internal']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost'];

/**
 * True when `rawHostname` (as parsed by `new URL(...)`) is an IP literal in
 * a blocked range, or a name that conventionally never leaves a private
 * network (`localhost`, `*.local`, `*.internal`).
 *
 * This does not resolve DNS — a public-looking domain that happens to
 * resolve to a private address is only caught by the `./node` entry, which
 * has the runtime to do that resolution.
 */
export function isPrivateOrReservedHostname(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);

  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return isBlockedIpAddress(hostname.slice(1, -1));
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return isBlockedIpAddress(hostname);
  }

  if (BLOCKED_EXACT.has(hostname)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function normalizeHostname(value: string): string {
  const lower = value.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

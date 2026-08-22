/**
 * IPv4/IPv6 range checks used to block private, loopback, link-local, and
 * other non-public network addresses.
 *
 * Pure and dependency-free on purpose: it has to run both inside a Cloudflare
 * Worker (no `node:net`/`node:dns`) and inside the Node runner, so it never
 * imports a Node built-in. Everything here operates on strings already
 * produced by the WHATWG `URL` parser (`url.hostname`) or by DNS resolution,
 * both of which hand back canonical dotted-decimal IPv4 or colon-form IPv6 —
 * `new URL('http://2130706433/').hostname` is already `'127.0.0.1'`, so this
 * module does not need to special-case decimal/hex/octal literals itself.
 */

type Ipv4Octets = readonly [number, number, number, number];

interface Ipv4Cidr {
  readonly base: Ipv4Octets;
  readonly prefixLength: number;
}

/**
 * Every IPv4 range that must not be reachable from a hosted audit.
 *
 * Includes RFC 1918 private ranges, loopback, link-local (which covers the
 * 169.254.169.254 cloud metadata endpoint), CGNAT, documentation/test
 * ranges, multicast, and the reserved/broadcast space.
 */
const IPV4_BLOCKED_RANGES: readonly Ipv4Cidr[] = [
  { base: [0, 0, 0, 0], prefixLength: 8 },
  { base: [10, 0, 0, 0], prefixLength: 8 },
  { base: [100, 64, 0, 0], prefixLength: 10 },
  { base: [127, 0, 0, 0], prefixLength: 8 },
  { base: [169, 254, 0, 0], prefixLength: 16 },
  { base: [172, 16, 0, 0], prefixLength: 12 },
  { base: [192, 0, 0, 0], prefixLength: 24 },
  { base: [192, 0, 2, 0], prefixLength: 24 },
  { base: [192, 88, 99, 0], prefixLength: 24 },
  { base: [192, 168, 0, 0], prefixLength: 16 },
  { base: [198, 18, 0, 0], prefixLength: 15 },
  { base: [198, 51, 100, 0], prefixLength: 24 },
  { base: [203, 0, 113, 0], prefixLength: 24 },
  { base: [224, 0, 0, 0], prefixLength: 4 },
  { base: [240, 0, 0, 0], prefixLength: 4 },
  { base: [255, 255, 255, 255], prefixLength: 32 },
];

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(ip: string): Ipv4Octets | null {
  const match = IPV4_PATTERN.exec(ip);
  if (match === null) return null;

  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;

  const [a, b, c, d] = octets;
  return [a ?? 0, b ?? 0, c ?? 0, d ?? 0];
}

export function isBlockedIPv4(ip: string): boolean {
  const octets = parseIPv4(ip);
  if (octets === null) return false;
  return IPV4_BLOCKED_RANGES.some((range) => matchesIPv4Cidr(octets, range));
}

function matchesIPv4Cidr(octets: Ipv4Octets, range: Ipv4Cidr): boolean {
  const mask = range.prefixLength === 0 ? 0 : (0xffffffff << (32 - range.prefixLength)) >>> 0;
  return (toUint32(octets) & mask) === (toUint32(range.base) & mask);
}

function toUint32(octets: Ipv4Octets): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/**
 * Parses a colon-form IPv6 literal (no brackets) into its eight 16-bit
 * groups, expanding `::` compression and the classic dotted-quad tail for
 * IPv4-mapped addresses (`::ffff:127.0.0.1`, not just the hex form Node's
 * `URL` normalizes to). Returns `null` for anything malformed, including a
 * `::` that would represent zero omitted groups — RFC 4291 requires it to
 * stand for at least one.
 */
export function parseIPv6(text: string): readonly number[] | null {
  const sections = text.split('::');
  if (sections.length > 2) return null;

  const headSource = sections[0];
  const rawHead = headSource === undefined || headSource === '' ? [] : headSource.split(':');
  const head = expandEmbeddedIPv4(rawHead);
  if (head === null) return null;

  if (sections.length === 1) {
    return head.length === 8 ? parseHextets(head) : null;
  }

  const tailSource = sections[1];
  const rawTail = tailSource === undefined || tailSource === '' ? [] : tailSource.split(':');
  const tail = expandEmbeddedIPv4(rawTail);
  if (tail === null) return null;

  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;

  return parseHextets([...head, ...Array<string>(missing).fill('0'), ...tail]);
}

/**
 * If the last `:`-separated part looks like a dotted IPv4 address (only
 * valid there, per RFC 4291), replaces it with the two hex groups it
 * represents. Returns the parts unchanged when there is no dotted tail, or
 * `null` when one is present but invalid.
 */
function expandEmbeddedIPv4(parts: readonly string[]): readonly string[] | null {
  if (parts.length === 0) return parts;
  const last = parts[parts.length - 1];
  if (last === undefined || !last.includes('.')) return parts;

  const octets = parseIPv4(last);
  if (octets === null) return null;

  const highGroup = ((octets[0] << 8) | octets[1]).toString(16);
  const lowGroup = ((octets[2] << 8) | octets[3]).toString(16);
  return [...parts.slice(0, -1), highGroup, lowGroup];
}

function parseHextets(groups: readonly string[]): readonly number[] | null {
  if (groups.length !== 8) return null;

  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    parsed.push(parseInt(group, 16));
  }
  return parsed;
}

export function isBlockedIPv6(ip: string): boolean {
  const groups = parseIPv6(ip);
  return groups === null ? false : isBlockedIPv6Groups(groups);
}

export function isBlockedIPv6Groups(groups: readonly number[]): boolean {
  if (groups.length !== 8) return false;

  const g = groups as readonly [number, number, number, number, number, number, number, number];

  // IPv4-mapped (::ffff:a.b.c.d) and the NAT64 well-known prefix
  // (64:ff9b::/96) both embed an IPv4 address in the low 32 bits — unwrap
  // and re-check it against the IPv4 rules instead of trusting the wrapper.
  const isMapped =
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  const isNat64 =
    g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  if (isMapped || isNat64) {
    const embedded: Ipv4Octets = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
    return isBlockedIPv4(embedded.join('.'));
  }

  if (g.every((value) => value === 0)) return true; // "::" unspecified
  if (
    g[0] === 0 &&
    g[1] === 0 &&
    g[2] === 0 &&
    g[3] === 0 &&
    g[4] === 0 &&
    g[5] === 0 &&
    g[6] === 0 &&
    g[7] === 1
  ) {
    return true; // ::1 loopback
  }

  const byte0 = g[0] >> 8;
  const byte1 = g[0] & 0xff;

  const isUniqueLocal = (byte0 & 0xfe) === 0xfc; // fc00::/7
  const isLinkLocal = byte0 === 0xfe && (byte1 & 0xc0) === 0x80; // fe80::/10
  const isMulticast = byte0 === 0xff; // ff00::/8
  const isDocumentation = g[0] === 0x2001 && g[1] === 0xdb8; // 2001:db8::/32

  return isUniqueLocal || isLinkLocal || isMulticast || isDocumentation;
}

/** Dispatches on whether `ip` (no brackets) looks like IPv6 or IPv4. */
export function isBlockedIpAddress(ip: string): boolean {
  return ip.includes(':') ? isBlockedIPv6(ip) : isBlockedIPv4(ip);
}

import { describe, expect, test } from 'vitest';
import { isBlockedIpAddress, isBlockedIPv4, isBlockedIPv6, parseIPv6 } from './ip-ranges.js';

describe('isBlockedIPv4', () => {
  test.each([
    ['0.0.0.0', true],
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.0.1', true],
    ['169.254.169.254', true], // cloud metadata endpoint
    ['169.254.0.1', true],
    ['100.64.0.1', true], // CGNAT
    ['100.127.255.255', true],
    ['100.128.0.1', false],
    ['192.0.2.1', true], // TEST-NET-1
    ['198.51.100.1', true], // TEST-NET-2
    ['203.0.113.1', true], // TEST-NET-3
    ['198.18.0.1', true], // benchmarking
    ['224.0.0.1', true], // multicast
    ['255.255.255.255', true], // broadcast
    ['240.0.0.1', true], // reserved
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['93.184.216.34', false], // example.com-ish public address
  ])('%s -> blocked=%s', (ip, expected) => {
    expect(isBlockedIPv4(ip)).toBe(expected);
  });

  test('rejects malformed input rather than throwing', () => {
    expect(isBlockedIPv4('not-an-ip')).toBe(false);
    expect(isBlockedIPv4('999.999.999.999')).toBe(false);
    expect(isBlockedIPv4('1.2.3')).toBe(false);
  });
});

describe('parseIPv6', () => {
  test('expands "::" compression', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  });

  test('parses a fully expanded address', () => {
    expect(parseIPv6('0:0:0:0:0:ffff:7f00:1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  test('rejects malformed input', () => {
    expect(parseIPv6('not:ipv6')).toBeNull();
    expect(parseIPv6('1:2:3::4:5:6:7:8')).toBeNull(); // too many groups with compression
    expect(parseIPv6('1:2:3:4:5:6:7')).toBeNull(); // too few groups, no compression
    expect(parseIPv6('1::2::3')).toBeNull(); // "::" used twice
  });
});

describe('isBlockedIPv6', () => {
  test.each([
    ['::1', true], // loopback
    ['::', true], // unspecified
    ['fe80::1', true], // link-local
    ['fc00::1', true], // unique local
    ['fd00::1', true], // unique local (other half of fc00::/7)
    ['ff02::1', true], // multicast
    ['2001:db8::1', true], // documentation range
    ['::ffff:127.0.0.1', true], // IPv4-mapped loopback, dotted form
    ['::ffff:7f00:1', true], // IPv4-mapped loopback, hex form (what URL parsing produces)
    ['::ffff:169.254.169.254', true], // IPv4-mapped cloud metadata
    ['64:ff9b::7f00:1', true], // NAT64-mapped loopback
    ['2606:4700:4700::1111', false], // public (Cloudflare DNS)
    ['2001:4860:4860::8888', false], // public (Google DNS)
  ])('%s -> blocked=%s', (ip, expected) => {
    expect(isBlockedIPv6(ip)).toBe(expected);
  });
});

describe('isBlockedIpAddress', () => {
  test('dispatches by colon presence', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('1.1.1.1')).toBe(false);
    expect(isBlockedIpAddress('2606:4700:4700::1111')).toBe(false);
  });
});

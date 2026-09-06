import { describe, expect, it } from 'vitest';
import { isAddressLiteral, isBlockedAddress } from './address.js';

describe('isBlockedAddress, IPv4', () => {
  it.each([
    ['10.0.0.1', 'private class A'],
    ['172.16.0.1', 'private class B, low end'],
    ['172.31.255.254', 'private class B, high end'],
    ['192.168.1.1', 'private class C'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback, the rest of the /8'],
    ['169.254.169.254', 'the cloud metadata address'],
    ['169.254.1.1', 'link-local generally, not just metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.100.100.200', "Alibaba's metadata address, inside CGNAT"],
    ['0.0.0.0', 'unspecified, which is localhost on Linux'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['198.18.0.1', 'benchmarking'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    // TEST-NET-3. Not globally routable, deliberately allowed: this guard is
    // about private-network reachability, not routability. See the design doc.
    ['203.0.113.9'],
    ['172.15.0.1'], // one below the private block
    ['172.32.0.1'], // one above it
    ['100.63.0.1'], // one below CGNAT
    ['100.128.0.1'], // one above it
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('isBlockedAddress, IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local, low end of the /7'],
    ['fdff::1', 'unique local, high end'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    // The spelling a careless filter misses. WHATWG URL parsing compresses
    // ::ffff:127.0.0.1 to exactly this, so this is the form that actually
    // arrives, not the readable one.
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex-compressed'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['64:ff9b::7f00:1', 'NAT64 wrapping loopback'],
    ['64:ff9b::a00:1', 'NAT64 wrapping 10.0.0.1'],
    ['100::1', 'the discard prefix'],
    ['fe80::1%eth0', 'a zone suffix must not defeat the check'],
    ['[::1]', 'brackets must not defeat the check'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([['2606:4700:4700::1111'], ['2404:6800:4003::200e']])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('allows an IPv4-mapped public address, so the unwrap is real and not a blanket block', () => {
    // If ::ffff:* were simply blocked, every test above would still pass and
    // the classifier would be lying about why.
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isBlockedAddress, garbage', () => {
  it.each([[''], ['not-an-address'], ['999.1.1.1'], ['10.0.0'], ['1.2.3.4.5'], ['::gggg']])(
    'blocks %s by failing closed',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );
});

describe('isAddressLiteral', () => {
  it.each([['127.0.0.1'], ['8.8.8.8'], ['::1'], ['2606:4700:4700::1111'], ['::ffff:7f00:1']])(
    'calls %s a literal',
    (hostname) => {
      expect(isAddressLiteral(hostname)).toBe(true);
    },
  );

  it.each([['nadiabakes.com'], ['localhost'], ['shop.example'], ['xn--nadia-9na.com']])(
    'calls %s a name',
    (hostname) => {
      // A name must never be treated as a literal: isBlockedAddress fails
      // closed on anything unparseable, so misreading names as addresses would
      // block every hostname on earth.
      expect(isAddressLiteral(hostname)).toBe(false);
    },
  );
});

import { describe, expect, it } from 'vitest';
import {
  allowsPrivateAddresses,
  BlockedAddressError,
  inspectSourceUrl,
  requirePublicAddresses,
} from './source-url.js';

describe('inspectSourceUrl', () => {
  it('accepts an ordinary shop URL', () => {
    const verdict = inspectSourceUrl('https://nadiabakes.com/menu');
    expect(verdict).toMatchObject({ ok: true, hostname: 'nadiabakes.com' });
  });

  it.each([
    ['file:///etc/passwd', 'not_http'],
    ['gopher://example.com/', 'not_http'],
    ['not a url at all', 'unparseable'],
    ['', 'unparseable'],
  ])('refuses %s as %s', (input, reason) => {
    expect(inspectSourceUrl(input)).toEqual({ ok: false, reason });
  });

  it('refuses embedded credentials', () => {
    // The parser accepts them and no legitimate paste has them, so they are
    // far likelier to be an attempt at a service that reads userinfo than a
    // shop owner's website.
    expect(inspectSourceUrl('http://user:pw@example.com/')).toEqual({
      ok: false,
      reason: 'has_credentials',
    });
  });

  it.each([
    ['http://127.0.0.1/', 'the plain spelling'],
    ['http://2130706433/', 'decimal'],
    ['http://0177.0.0.1/', 'octal'],
    ['http://0x7f000001/', 'hex'],
    ['http://127.1/', 'short form'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped'],
    ['http://[fd00::1]/', 'unique local'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ])('refuses %s (%s) without resolving anything', (input) => {
    expect(inspectSourceUrl(input)).toEqual({ ok: false, reason: 'blocked_address' });
  });

  it('strips the brackets from an IPv6 hostname it accepts', () => {
    // url.hostname keeps them, and a resolver handed '[2606:...]' will fail in
    // a way that looks like a network problem rather than a bug here.
    const verdict = inspectSourceUrl('http://[2606:4700:4700::1111]/');
    expect(verdict).toMatchObject({ ok: true, hostname: '2606:4700:4700::1111' });
  });

  it('does not judge a hostname, because it cannot', () => {
    // localhost is blocked by what it resolves to, not by its spelling. A name
    // check here would imply a completeness this function cannot have.
    expect(inspectSourceUrl('http://localhost:8099/')).toMatchObject({ ok: true });
  });
});

describe('requirePublicAddresses', () => {
  const publicOne = { address: '203.0.113.9', family: 4 };
  const privateOne = { address: '127.0.0.1', family: 4 };

  it('returns every address when all of them are public', () => {
    expect(requirePublicAddresses([publicOne], { allowPrivate: false })).toEqual([publicOne]);
  });

  it('rejects the whole answer when any one address is private', () => {
    // The mixed answer is the entire trick. Filtering the private entry out and
    // dialling the survivor is the plausible-looking version of this function
    // that does not work.
    expect(() => requirePublicAddresses([publicOne, privateOne], { allowPrivate: false })).toThrow(
      BlockedAddressError,
    );
  });

  it('rejects an empty answer', () => {
    expect(() => requirePublicAddresses([], { allowPrivate: false })).toThrow(BlockedAddressError);
  });

  it('keeps the offending address off the message and on the error', () => {
    // extract.service.ts writes error.message into Ingestion.error, which
    // getIngestion returns to the owner. The message is for them; `blocked` is
    // for the log.
    try {
      requirePublicAddresses([privateOne], { allowPrivate: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BlockedAddressError);
      expect((error as BlockedAddressError).message).not.toContain('127.0.0.1');
      expect((error as BlockedAddressError).blocked).toBe('127.0.0.1');
    }
  });

  it('lets everything through when private addresses are allowed', () => {
    expect(requirePublicAddresses([privateOne], { allowPrivate: true })).toEqual([privateOne]);
  });
});

describe('allowsPrivateAddresses', () => {
  it('allows only the exact string true', () => {
    expect(allowsPrivateAddresses('true')).toBe(true);
  });

  it.each([[undefined], [''], ['TRUE'], ['True'], ['1'], ['yes'], ['false'], [' true']])(
    'denies %s',
    (raw) => {
      expect(allowsPrivateAddresses(raw)).toBe(false);
    },
  );
});

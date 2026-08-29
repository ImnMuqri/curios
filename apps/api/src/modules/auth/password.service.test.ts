import { describe, expect, it } from 'vitest';
import { hashPassword, isBreached, verifyPassword } from './password.service.js';

describe('hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
  });

  it('salts, so the same password twice does not produce the same hash', async () => {
    const first = await hashPassword('same');
    const second = await hashPassword('same');

    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'same')).toBe(true);
    expect(await verifyPassword(second, 'same')).toBe(true);
  });

  it('uses argon2id at the parameters ADMIN.md specifies', async () => {
    const hash = await hashPassword('anything');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
  });

  it('returns false rather than throwing on a hash it cannot parse', async () => {
    // A corrupted row must fail that one login, not 500 the endpoint.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('breach screening', () => {
  it('rejects a password whose hash suffix appears in the range response', async () => {
    // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
    const fetcher = async () => ({
      ok: true,
      text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:12345',
    });

    expect(await isBreached('password', fetcher)).toBe(true);
  });

  it('accepts a password absent from the range response', async () => {
    const fetcher = async () => ({
      ok: true,
      text: async () => 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1',
    });

    expect(await isBreached('password', fetcher)).toBe(false);
  });

  it('sends only the first five characters of the hash, never the password', async () => {
    let requested = '';
    const fetcher = async (url: string) => {
      requested = url;
      return { ok: true, text: async () => '' };
    };

    await isBreached('password', fetcher);

    expect(requested).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    // The path, not the whole URL: the HIBP hostname api.pwnedpasswords.com
    // itself contains the substring, so asserting on the whole URL can never
    // pass. What must not leak is the part we build, which is the path.
    expect(new URL(requested).pathname).not.toContain('password');
  });

  it('fails open when the service is unreachable', async () => {
    const fetcher = async () => {
      throw new Error('network down');
    };

    // A third party's availability must not decide whether someone can sign up.
    expect(await isBreached('password', fetcher)).toBe(false);
  });
});

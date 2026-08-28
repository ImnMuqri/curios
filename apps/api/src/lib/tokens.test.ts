import { describe, expect, it } from 'vitest';
import { createToken, hashToken } from './tokens.js';

describe('createToken', () => {
  it('returns a value and the hash that will be stored in its place', () => {
    const { value, hash } = createToken();

    expect(hashToken(value)).toBe(hash);
    // The stored form must not contain the secret in any recoverable way.
    expect(hash).not.toContain(value);
    expect(value).not.toContain(hash);
  });

  it('is unguessable: 1000 tokens produce 1000 distinct values of full length', () => {
    const values = new Set(Array.from({ length: 1000 }, () => createToken().value));

    expect(values.size).toBe(1000);
    // 32 bytes base64url, unpadded.
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('hashToken', () => {
  it('is stable, so a token presented twice finds the same row', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

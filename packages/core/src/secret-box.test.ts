import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, paymentSecretsKey, sealSecret } from './secret-box.js';

const key = randomBytes(32);

describe('sealSecret and openSecret', () => {
  it('the secret key round-trips and a tampered box refuses to open', () => {
    const sealed = sealSecret('chip-secret-key-123', key);

    expect(openSecret(sealed, key)).toBe('chip-secret-key-123');

    const bytes = Buffer.from(sealed, 'base64');
    for (const at of [1, 13, 29, bytes.length - 1]) {
      const tampered = Buffer.from(bytes);
      tampered[at] = tampered[at]! ^ 0x01;
      expect(() => openSecret(tampered.toString('base64'), key)).toThrow();
    }
  });

  it('never holds the secret in the clear, and seals the same secret differently each time', () => {
    const one = sealSecret('chip-secret-key-123', key);
    const two = sealSecret('chip-secret-key-123', key);

    expect(one).not.toBe(two);
    expect(Buffer.from(one, 'base64').toString('latin1')).not.toContain('chip-secret');
  });

  it('is base64 of a version byte, a 12-byte IV, a 16-byte tag and the ciphertext', () => {
    const bytes = Buffer.from(sealSecret('abc', key), 'base64');

    expect(bytes[0]).toBe(0x01);
    expect(bytes.length).toBe(1 + 12 + 16 + 3);
  });

  it('refuses a wrong key, an unknown version, and a box too short to be one', () => {
    const sealed = sealSecret('chip-secret-key-123', key);
    expect(() => openSecret(sealed, randomBytes(32))).toThrow();

    const bytes = Buffer.from(sealed, 'base64');
    bytes[0] = 0x02;
    expect(() => openSecret(bytes.toString('base64'), key)).toThrow(/version/);

    expect(() => openSecret(Buffer.from([1, 2, 3]).toString('base64'), key)).toThrow(/short/);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealSecret('x', randomBytes(16))).toThrow(/32 bytes/);
    expect(() => openSecret('AQ==', randomBytes(31))).toThrow(/32 bytes/);
  });
});

describe('paymentSecretsKey', () => {
  it('reads 32 bytes of base64', () => {
    const value = randomBytes(32).toString('base64');
    expect(paymentSecretsKey({ PAYMENT_SECRETS_KEY: value })?.equals(Buffer.from(value, 'base64'))).toBe(true);
  });

  it('is null when unset or blank', () => {
    expect(paymentSecretsKey({})).toBeNull();
    expect(paymentSecretsKey({ PAYMENT_SECRETS_KEY: '  ' })).toBeNull();
  });

  it('says clearly what is wrong with anything else', () => {
    for (const bad of [randomBytes(16).toString('base64'), 'not base64 at all!', randomBytes(32).toString('hex')]) {
      expect(() => paymentSecretsKey({ PAYMENT_SECRETS_KEY: bad })).toThrow(/PAYMENT_SECRETS_KEY must be the base64 of 32 bytes/);
    }
  });
});

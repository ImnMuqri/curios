import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePublicKey, verifyChipSignature } from './signature.js';

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const { publicKey, privateKey } = pair();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const body = '{"id":"p-1","status":"paid"}';
const signed = (text: string) => sign('sha256', Buffer.from(text), privateKey).toString('base64');

describe('verifyChipSignature', () => {
  it('verifies a genuine signature', () => {
    expect(verifyChipSignature(body, signed(body), publicPem)).toBe(true);
  });

  it('refuses a changed body', () => {
    expect(verifyChipSignature(`${body} `, signed(body), publicPem)).toBe(false);
  });

  it('refuses a missing, empty or non-base64 signature', () => {
    expect(verifyChipSignature(body, undefined, publicPem)).toBe(false);
    expect(verifyChipSignature(body, '', publicPem)).toBe(false);
    expect(verifyChipSignature(body, '!!not base64!!', publicPem)).toBe(false);
    expect(verifyChipSignature(body, 'abc', publicPem)).toBe(false);
  });

  it('refuses a signature from another key', () => {
    const other = pair();
    const foreign = sign('sha256', Buffer.from(body), other.privateKey).toString('base64');
    expect(verifyChipSignature(body, foreign, publicPem)).toBe(false);
  });

  it('refuses a key that is not a key', () => {
    expect(verifyChipSignature(body, signed(body), 'not a pem')).toBe(false);
    expect(verifyChipSignature(body, signed(body), '')).toBe(false);
  });
});

describe('parsePublicKey', () => {
  it('decodes the JSON-quoted PEM and refuses anything else', () => {
    expect(parsePublicKey(JSON.stringify(publicPem))).toBe(publicPem);
    expect(() => parsePublicKey(publicPem)).toThrow();
    expect(() => parsePublicKey('"just a string"')).toThrow();
    expect(() => parsePublicKey('{"key":"x"}')).toThrow();
    expect(() => parsePublicKey('')).toThrow();
  });
});

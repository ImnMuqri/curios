import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, decodeAvatar } from './avatar.js';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')];

describe('decodeAvatar', () => {
  it('accepts each allowed type when the bytes agree', () => {
    expect(decodeAvatar({ contentType: 'image/png', data: b64(PNG) }).ext).toBe('png');
    expect(decodeAvatar({ contentType: 'image/jpeg', data: b64(JPEG) }).ext).toBe('jpg');
    expect(decodeAvatar({ contentType: 'image/webp', data: b64(WEBP) }).ext).toBe('webp');
  });

  // Review Focus 4: the declared type is a claim; the bytes are the evidence.
  it('refuses bytes that are not the type they claim', () => {
    expect(() => decodeAvatar({ contentType: 'image/webp', data: b64(JPEG) })).toThrow(/INVALID_IMAGE|picture/i);
    expect(() => decodeAvatar({ contentType: 'image/png', data: Buffer.from('hello').toString('base64') })).toThrow();
  });

  it('refuses anything over AVATAR_MAX_BYTES', () => {
    const big = Buffer.concat([Buffer.from(PNG), Buffer.alloc(AVATAR_MAX_BYTES)]).toString('base64');
    expect(() => decodeAvatar({ contentType: 'image/png', data: big })).toThrow();
  });

  it('refuses an empty upload', () => {
    expect(() => decodeAvatar({ contentType: 'image/png', data: '' })).toThrow();
  });
});

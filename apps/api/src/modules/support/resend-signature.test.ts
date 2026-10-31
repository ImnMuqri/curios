import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyResendSignature } from './resend-signature.js';

const secret = `whsec_${Buffer.from('a-known-signing-key').toString('base64')}`;
const now = new Date('2026-10-31T10:00:00Z');
const id = 'msg_123';
const rawBody = '{"type":"email.received","data":{"email_id":"e1"}}';

const sign = (timestamp: string, body = rawBody) =>
  `v1,${createHmac('sha256', Buffer.from('a-known-signing-key')).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
const stamp = (at: Date) => String(Math.floor(at.getTime() / 1000));

describe('verifyResendSignature', () => {
  it('passes a body signed with the secret', () => {
    const timestamp = stamp(now);
    expect(verifyResendSignature({ id, timestamp, signature: sign(timestamp), rawBody, secret, now })).toBe(true);
  });

  it('fails when one byte of the body changed', () => {
    const timestamp = stamp(now);
    const signature = sign(timestamp);
    expect(verifyResendSignature({ id, timestamp, signature, rawBody: rawBody.replace('e1', 'e2'), secret, now })).toBe(false);
  });

  it('fails a timestamp 301 seconds old, and passes one 299 old', () => {
    const old = stamp(new Date(now.getTime() - 301_000));
    expect(verifyResendSignature({ id, timestamp: old, signature: sign(old), rawBody, secret, now })).toBe(false);
    const recent = stamp(new Date(now.getTime() - 299_000));
    expect(verifyResendSignature({ id, timestamp: recent, signature: sign(recent), rawBody, secret, now })).toBe(true);
  });

  it('passes when only the second of two signatures matches', () => {
    const timestamp = stamp(now);
    const signature = `v1,${Buffer.from('not it').toString('base64')} ${sign(timestamp)}`;
    expect(verifyResendSignature({ id, timestamp, signature, rawBody, secret, now })).toBe(true);
  });

  it('fails when a header is missing', () => {
    const timestamp = stamp(now);
    expect(verifyResendSignature({ timestamp, signature: sign(timestamp), rawBody, secret, now })).toBe(false);
    expect(verifyResendSignature({ id, signature: sign(timestamp), rawBody, secret, now })).toBe(false);
    expect(verifyResendSignature({ id, timestamp, rawBody, secret, now })).toBe(false);
  });
});

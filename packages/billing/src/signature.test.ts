import { describe, expect, it } from 'vitest';
import {
  flattenRedirectParams,
  signatureSource,
  verifyBillplzSignature,
} from './signature.js';

/**
 * Every signature below was computed with OpenSSL 3.2.3, outside this code:
 *
 *   printf '%s' '<source string>' | openssl dgst -sha256 -hmac 'S-test-signing-key-not-a-real-secret'
 *
 * So these prove the code builds the construction Billplz's docs describe. They
 * cannot prove Billplz signs that way -- the docs' own example hides its email and
 * never states its key. Only the sandbox round trip in the walkthrough proves that.
 */
const KEY = 'S-test-signing-key-not-a-real-secret';

const callback: Record<string, string> = {
  id: 'zq0tm2wc',
  collection_id: 'yhx5t1pp',
  paid: 'true',
  state: 'paid',
  amount: '3900',
  paid_amount: '3900',
  due_at: '2026-9-14',
  email: 'owner@example.com',
  mobile: '',
  name: 'Nadia Bakes',
  url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
  paid_at: '2026-09-14 15:15:09 +0800',
};

const CALLBACK_SOURCE =
  'amount3900|collection_idyhx5t1pp|due_at2026-9-14|emailowner@example.com|idzq0tm2wc|mobile|nameNadia Bakes|paid_amount3900|paid_at2026-09-14 15:15:09 +0800|paidtrue|statepaid|urlhttps://www.billplz-sandbox.com/bills/zq0tm2wc';
const CALLBACK_SIGNATURE = '97d9f80f609867b9392b9a0b2a8d6e20d36130d2ccd9f877c64b6b0758d3e9b9';
const WITH_TRANSACTION_SIGNATURE =
  'd4cc3508d10e6aadc7acd9009a8fcc2c156875e883070d713d6e996c28cd25e5';
const REDIRECT_SOURCE =
  'billplzidzq0tm2wc|billplzpaid_at2026-09-14 15:15:09 +0800|billplzpaidtrue';
const REDIRECT_SIGNATURE = 'c83bf46ae199744df89608daab62739a8b3157f99d73ee3d60dcbfd5b8b2e681';

describe('signatureSource', () => {
  it('sorts the joined pairs, not the keys, as the docs example does', () => {
    // Sorting by key would put `paidtrue` before `paid_amount3900`. Sorting the
    // joined strings puts `_` (0x5F) before `t` (0x74), which is the docs' order.
    expect(signatureSource(callback)).toBe(CALLBACK_SOURCE);
  });

  it('leaves the signature itself out', () => {
    expect(signatureSource({ ...callback, x_signature: 'anything' })).toBe(CALLBACK_SOURCE);
  });
});

describe('verifyBillplzSignature', () => {
  it('accepts a correctly signed callback', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: CALLBACK_SIGNATURE }, KEY)).toBe(true);
  });

  it('signs transaction fields when they arrive, rather than a fixed list', () => {
    const withTransaction = {
      ...callback,
      transaction_id: 'AC4GC031F42H',
      transaction_status: 'completed',
      x_signature: WITH_TRANSACTION_SIGNATURE,
    };
    expect(verifyBillplzSignature(withTransaction, KEY)).toBe(true);
  });

  it('refuses a tampered amount', () => {
    expect(
      verifyBillplzSignature({ ...callback, paid_amount: '100', x_signature: CALLBACK_SIGNATURE }, KEY),
    ).toBe(false);
  });

  it('refuses a callback with no signature', () => {
    expect(verifyBillplzSignature(callback, KEY)).toBe(false);
  });

  it('refuses a signature of the wrong length without throwing', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: 'abc' }, KEY)).toBe(false);
  });

  it('refuses when there is no key to check against', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: CALLBACK_SIGNATURE }, '')).toBe(false);
  });
});

describe('flattenRedirectParams', () => {
  const redirect = {
    'billplz[id]': 'zq0tm2wc',
    'billplz[paid]': 'true',
    'billplz[paid_at]': '2026-09-14 15:15:09 +0800',
    'billplz[x_signature]': REDIRECT_SIGNATURE,
  };

  it('keys the redirect the way its signature is computed, brackets dropped', () => {
    expect(signatureSource(flattenRedirectParams(redirect))).toBe(REDIRECT_SOURCE);
  });

  it('verifies a correctly signed redirect', () => {
    expect(verifyBillplzSignature(flattenRedirectParams(redirect), KEY)).toBe(true);
  });

  it('leaves out query parameters that are not Billplz’s', () => {
    expect(flattenRedirectParams({ ...redirect, utm_source: 'mail' })).not.toHaveProperty('utm_source');
  });
});

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Billplz's X Signature source string, as its API docs state it (checked 2026-09-14).
 *
 * Every parameter except `x_signature`; each key concatenated directly to its value;
 * the joined strings -- not the keys -- sorted ascending and case-insensitively;
 * joined with `|`. Built from whatever parameters arrived, never from a fixed list:
 * `transaction_id` and `transaction_status` appear only sometimes and are signed when
 * they do, so a fixed list would refuse every genuine payment that carries them.
 *
 * Case-insensitive means lowercased code points, as PHP's case-insensitive string
 * sort compares. Not `localeCompare`, whose collation of `_` against letters depends
 * on the ICU build it runs on.
 */
export function signatureSource(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([key]) => key !== 'x_signature')
    .map(([key, value]) => `${key}${value}`)
    .sort((a, b) => {
      const left = a.toLowerCase();
      const right = b.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .join('|');
}

export function signBillplz(params: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(signatureSource(params)).digest('hex');
}

/**
 * Whether `params` were signed by the holder of `key`. False rather than throwing for
 * anything malformed: a missing signature, a missing key, a value of the wrong length.
 * A false here must always mean "do not grant" -- there is no path around it.
 */
export function verifyBillplzSignature(params: Record<string, string>, key: string): boolean {
  const received = params.x_signature;
  if (!received || !key) return false;

  const expected = Buffer.from(signBillplz(params, key), 'utf8');
  const actual = Buffer.from(received, 'utf8');
  // timingSafeEqual throws on unequal lengths, and a different length is simply wrong.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The redirect's parameters, keyed the way its signature is computed.
 *
 * Billplz sends them nested -- `billplz[id]` -- and the docs show the key hashed with
 * the prefix kept and the brackets dropped: `billplzid`. `billplz[x_signature]` carries
 * the signature itself. Anything not under `billplz[` is not Billplz's and is left out.
 */
export function flattenRedirectParams(query: Record<string, string>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const match = /^billplz\[(.+)\]$/.exec(key);
    const name = match?.[1];
    if (!name) continue;
    flat[name === 'x_signature' ? 'x_signature' : `billplz${name}`] = value;
  }
  return flat;
}

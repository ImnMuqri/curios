import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a delivery's timestamp may be from now, either way. Svix's own default. */
const TOLERANCE_MS = 5 * 60 * 1000;

/** Below this a key is a misconfiguration, not a secret: an empty one lets anyone compute the HMAC. */
const MIN_KEY_BYTES = 16;

/** The HMAC key inside a `whsec_<base64>` secret, or null when it is too short to be one. */
export function signingKey(secret: string): Buffer | null {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return key.length >= MIN_KEY_BYTES ? key : null;
}

export interface ResendSignatureInput {
  /** The `svix-id` header. */
  id?: string;
  /** The `svix-timestamp` header: Unix seconds. */
  timestamp?: string;
  /** The `svix-signature` header: space-separated `v1,<base64>` entries. */
  signature?: string;
  /** The body exactly as received. */
  rawBody: string;
  /** The endpoint's signing secret, `whsec_<base64>` as Resend shows it. */
  secret: string;
  now?: Date;
}

/**
 * Resend signs webhooks with Svix's scheme: HMAC-SHA256, keyed by the base64-decoded secret,
 * over `${id}.${timestamp}.${rawBody}`. The header may carry several signatures (a secret
 * being rotated), and any one matching passes.
 */
export function verifyResendSignature(input: ResendSignatureInput): boolean {
  const { id, timestamp, signature, rawBody, secret } = input;
  if (!id || !timestamp || !signature) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs((input.now ?? new Date()).getTime() - seconds * 1000) > TOLERANCE_MS) return false;

  const key = signingKey(secret);
  if (!key) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

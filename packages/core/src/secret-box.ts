import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * A secret at rest: an owner's CHIP secret key, sealed before it is stored and
 * opened only on the server, just before a call to CHIP.
 *
 * AES-256-GCM with a random 12-byte IV, stored as
 * `base64(version | iv | tag | ciphertext)`. The tag makes any change to the
 * stored box -- or opening it with the wrong key -- throw rather than hand back
 * a wrong secret. The version byte is there so the key can change later: a new
 * version can be opened with a new key while old boxes still name theirs.
 *
 * Server only. Exported on `@curios/core/secret-box`, never from the barrel or
 * a client-safe subpath.
 */

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function checkKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`A secret box key is ${KEY_BYTES} bytes, not ${key.length}.`);
}

export function sealSecret(plain: string, key: Buffer): string {
  checkKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openSecret(sealed: string, key: Buffer): string {
  checkKey(key);
  const bytes = Buffer.from(sealed, 'base64');
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('This secret box is too short to be one.');
  if (bytes[0] !== VERSION) throw new Error(`This secret box has version ${bytes[0]}, which this code cannot open.`);
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

/**
 * The key that seals owners' payment secrets, from PAYMENT_SECRETS_KEY: the
 * base64 of 32 random bytes. Null when unset or blank -- whether that is
 * allowed is the caller's decision (production refuses to start). Anything
 * else set there is a mistake, and says so.
 */
export function paymentSecretsKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.PAYMENT_SECRETS_KEY?.trim();
  if (!raw) return null;
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "PAYMENT_SECRETS_KEY must be the base64 of 32 bytes. Make one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

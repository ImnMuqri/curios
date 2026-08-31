import { randomBytes } from 'node:crypto';
import { hashSessionValue } from '@curios/core';

/**
 * Opaque bearer tokens: session cookies, email verification links, password
 * reset links.
 *
 * The caller sends `value` to the person and stores `hash`. Lookup is by exact
 * hash, so hashing costs one comparison and buys the property that a database
 * leak yields nothing anyone can present. This is the same reasoning that
 * applies to passwords, and the reason no code path anywhere stores `value`.
 *
 * SHA-256 rather than argon2 deliberately: these are 256 bits of randomness, not
 * user-chosen secrets, so there is nothing for a slow hash to protect against.
 */
export function createToken(): { value: string; hash: string } {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: hashToken(value) };
}

/** Kept as a name because sessions and auth tokens both hash their value the
 *  same way; the implementation moved to @curios/core so packages/db-read can
 *  use it too. */
export const hashToken = hashSessionValue;

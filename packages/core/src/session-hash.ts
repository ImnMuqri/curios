import { createHash } from 'node:crypto';

/**
 * The lookup key for a session or auth token: SHA-256 of the value the
 * browser holds.
 *
 * Lives here rather than in `apps/api` because `packages/db-read` needs the
 * same hash to validate a session for the `/app` layout, and cannot import
 * from an app. Two implementations of one security primitive is how they
 * drift apart; there is exactly one, and both sides import it.
 *
 * SHA-256 and not argon2 on purpose: the input is 32 random bytes, so there is
 * no guessing to slow down, and lookup is by exact match.
 */
export function hashSessionValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

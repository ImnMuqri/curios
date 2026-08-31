/**
 * A session's two clocks. Shared here rather than declared once in
 * `apps/api` and read nowhere else, because `packages/db-read` has to
 * enforce the same idle window as the API's `validateSession` when it checks
 * a session for the `/app` layout -- the same reasoning that moved the
 * session hash into this package in an earlier task. Duplicating either
 * number into a second package is exactly how the two end up disagreeing
 * about who is still signed in.
 */

/** However active the owner, a session dies 30 days after it was issued. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** An untouched session dies after a fortnight. */
export const SESSION_IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The name of the session cookie.
 *
 * Here rather than in `apps/api` because `apps/web` reads it too -- middleware
 * checks it is present, and the authed layout hands its value to
 * `getOwnerSession` -- and cannot import from an app. The same reasoning that
 * moved the session hash and the TTLs here: one definition, or the two sides
 * eventually disagree and the symptom is a cookie nobody reads.
 */
export const SESSION_COOKIE = 'curios_session';

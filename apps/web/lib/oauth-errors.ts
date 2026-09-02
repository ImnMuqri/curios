/**
 * What each code the OAuth callback's redirect can carry means to a person
 * reading it, plus a generic fallback for anything else.
 *
 * Shared by `/app/settings` (linking) and `/signin` (signing in) on purpose --
 * D2. It used to live only in `app/app/settings/settings.ts`, and `/signin`
 * had no equivalent table at all, so a sign-in failure landed on an ordinary
 * form with no explanation. A second, `/signin`-only copy would fix that but
 * reintroduce the exact problem this module exists to avoid: two
 * hand-maintained tables that can silently disagree about what a code means.
 * One table, one fallback, both screens.
 *
 * The codes themselves come from the API's `callbackErrorCode`
 * (`apps/api/src/modules/auth/auth.routes.ts`), which only ever emits a
 * lower-cased member of `DOMAIN_ERROR_CODES`
 * (`apps/api/src/plugins/errors.ts`) or `internal_error`. This table is not
 * imported from there because `apps/web` may not import `apps/api`, so the
 * two are kept in sync by hand -- the fallback below is what keeps that
 * manageable: an unrecognised code still reads as "something failed, try
 * again" rather than as a raw code on the screen.
 *
 * `identity_taken` and `unauthenticated` are link-only: the callback only
 * ever sends them to `/app/settings`, never to `/signin` (linking requires an
 * existing session, so "already connected" and "session ended" are both
 * link-flow-only questions). They stay in this one table anyway rather than
 * being split into a second, settings-only copy -- do not prune them as dead
 * code for `/signin`.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  identity_taken: 'That Google account is already connected to another Curios account.',
  unauthenticated: 'Your session ended before the connection finished. Sign in and try again.',
  oauth_state_mismatch: 'That connection attempt is no longer valid. Try connecting again.',
  email_not_verified: 'That Google account has no verified email address.',
  // D1: the one case this table must get right on its own. A misconfigured
  // client secret or an outage at Google is not something retrying fixes, so
  // this deliberately does not say "try again" -- see OAuthExchangeError's
  // comment in apps/api/src/modules/auth/oauth.service.ts for why that
  // distinction exists at all.
  internal_error: 'Something went wrong on our side while connecting to Google.',
};

const GENERIC_FALLBACK = 'Something failed while connecting. Try again.';

/** A code's sentence, or the generic fallback for one this table does not know. */
export function oauthErrorMessage(code: string): string {
  return OAUTH_ERROR_MESSAGES[code] ?? GENERIC_FALLBACK;
}

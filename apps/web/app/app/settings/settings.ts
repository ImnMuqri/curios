import type { SignInMethods } from '@curios/db-read';

export interface SettingsView {
  email: string;
  showAddPassword: boolean;
  showConnectGoogle: boolean;
}

/**
 * Which forms this screen shows, extracted so the decision can be tested
 * without rendering a Server Component -- the shape F7 established in Task 1
 * with `resolveOwner`.
 *
 * No "Add a password" for an account that already has one; no
 * "Connect Google" for one already connected. An account with both gets
 * neither form and must still be told something useful -- empty states are
 * instructions, not moods -- which `page.tsx` handles by falling back to a
 * plain sentence when both flags here are false.
 */
export function decideSettingsView(methods: SignInMethods): SettingsView {
  return {
    email: methods.email,
    showAddPassword: !methods.hasPassword,
    showConnectGoogle: !methods.providers.includes('GOOGLE'),
  };
}

export type SettingsBanner = { kind: 'linked' } | { kind: 'error'; message: string };

/**
 * What this screen carries in its own words are only what happened.
 *
 * Every code the callback's redirect can send is covered by an EXPLICIT
 * message -- reusing the API's own sentence where one already exists, e.g.
 * `IdentityTakenError`'s -- with a generic fallback for anything else. The
 * codes are documented in the API's `CALLBACK_ERROR_CODES`
 * (`apps/api/src/modules/auth/auth.routes.ts`); this list is not imported
 * from there because `apps/web` may not import `apps/api`, so the two lists
 * are kept in sync by hand. The fallback is what keeps that manageable: an
 * unrecognised code still reads as "something failed, try again" rather than
 * as a raw code on the screen.
 */
const ERROR_MESSAGES: Record<string, string> = {
  identity_taken: 'That Google account is already connected to another Curios account.',
  unauthenticated: 'Your session ended before the connection finished. Sign in and try again.',
  oauth_state_mismatch: 'That connection attempt is no longer valid. Try connecting again.',
  oauth_exchange_failed: 'Google could not be reached just now. Try again in a moment.',
  email_not_verified: 'That Google account has no verified email address.',
};

/**
 * What this screen says about how it was reached, decided from the query
 * string alone -- same extraction as `decideSettingsView`, for the same
 * reason.
 */
export function decideSettingsBanner(params: { linked?: string; error?: string }): SettingsBanner | null {
  if (params.linked === 'google') return { kind: 'linked' };
  if (params.error) {
    return { kind: 'error', message: ERROR_MESSAGES[params.error] ?? 'Something failed while connecting. Try again.' };
  }
  return null;
}

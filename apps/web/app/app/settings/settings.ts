import type { SignInMethods } from '@curios/db-read';
import { oauthErrorMessage } from '../../../lib/oauth-errors.js';

export interface SettingsView {
  email: string;
  showAddPassword: boolean;
  showConnectGoogle: boolean;
  /** The Google account's own address, shown on the Google row once connected. */
  googleEmail: string | null;
  /** The line under "Signing in". */
  signNote: string;
}

/**
 * Which forms this screen shows, extracted so the decision can be tested
 * without rendering a Server Component -- the shape F7 established in Task 1
 * with `resolveOwner`.
 *
 * No "Add a password" for an account that already has one; no
 * "Connect Google" for one already connected. An account with both gets
 * neither form and must still be told something useful -- empty states are
 * instructions, not moods -- so `signNote` says both ways work.
 */
export function decideSettingsView(methods: SignInMethods): SettingsView {
  const google = methods.providers.includes('GOOGLE');
  return {
    email: methods.email,
    showAddPassword: !methods.hasPassword,
    showConnectGoogle: !google,
    googleEmail: google ? (methods.googleEmail ?? methods.email) : null,
    signNote:
      methods.hasPassword && google
        ? 'You can sign in with your password or with Google.'
        : 'Add a second way in, for the day the first one fails you.',
  };
}

export type SettingsBanner = { kind: 'linked' } | { kind: 'error'; message: string };

/**
 * What this screen says about how it was reached, decided from the query
 * string alone -- same extraction as `decideSettingsView`, for the same
 * reason.
 *
 * The message itself comes from `oauthErrorMessage` in `lib/oauth-errors.ts`,
 * shared with `/signin` -- D2. It used to be a copy of that table kept here
 * by hand; a second copy is how the two screens would end up disagreeing
 * about what a code means.
 */
export function decideSettingsBanner(params: { linked?: string; error?: string }): SettingsBanner | null {
  if (params.linked === 'google') return { kind: 'linked' };
  if (params.error) return { kind: 'error', message: oauthErrorMessage(params.error) };
  return null;
}

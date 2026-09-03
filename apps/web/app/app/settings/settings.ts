import type { SignInMethods } from '@curios/db-read';
import { oauthErrorMessage } from '../../../lib/oauth-errors.js';

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

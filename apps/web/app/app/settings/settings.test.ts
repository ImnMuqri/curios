import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from '../../../lib/oauth-errors.js';
import { decideSettingsBanner, decideSettingsView } from './settings.js';

describe('decideSettingsView', () => {
  it('offers to add a password for a Google-only account', () => {
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: false, providers: ['GOOGLE'], googleEmail: 'lina.bakes@gmail.example' });

    expect(view.showAddPassword).toBe(true);
    expect(view.showConnectGoogle).toBe(false);
    expect(view.email).toBe('nadia@example.com');
  });

  it('offers to connect Google for a password-only account', () => {
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: true, providers: [], googleEmail: null });

    expect(view.showAddPassword).toBe(false);
    expect(view.showConnectGoogle).toBe(true);
  });

  it('offers neither form to an account that already has both', () => {
    // Empty states are instructions, not moods -- an account with both must
    // still be told something useful, not shown a blank screen.
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: true, providers: ['GOOGLE'], googleEmail: 'lina.bakes@gmail.example' });

    expect(view.showAddPassword).toBe(false);
    expect(view.showConnectGoogle).toBe(false);
    expect(view.signNote).toBe('You can sign in with your password or with Google.');
    expect(view.googleEmail).toBe('lina.bakes@gmail.example');
  });

  it('asks for a second way in while there is only one', () => {
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: true, providers: [], googleEmail: null });

    expect(view.signNote).toBe('Add a second way in, for the day the first one fails you.');
    expect(view.googleEmail).toBeNull();
  });
});

describe('decideSettingsBanner', () => {
  it('says nothing when there is nothing to report', () => {
    expect(decideSettingsBanner({})).toBeNull();
  });

  it('confirms a successful Google link', () => {
    expect(decideSettingsBanner({ linked: 'google' })).toEqual({ kind: 'linked' });
  });

  it('explains an already-linked identity using the shared table, not an invented one', () => {
    // C2: the callback can only carry a CODE back on the redirect, not the
    // API's own message text -- that is lost the moment this became a
    // redirect instead of a JSON body. D2: turning the code back into
    // something a person can read is `lib/oauth-errors.ts`'s job now, shared
    // with `/signin`, so this asserts the delegation rather than a hardcoded
    // copy of the sentence -- a second copy here is exactly the drift D2
    // exists to prevent.
    const banner = decideSettingsBanner({ error: 'identity_taken' });

    expect(banner).toEqual({ kind: 'error', message: oauthErrorMessage('identity_taken') });
  });

  it('falls back to a generic message for a code it does not recognise', () => {
    const banner = decideSettingsBanner({ error: 'something_new' });

    expect(banner).toEqual({ kind: 'error', message: oauthErrorMessage('something_new') });
  });
});

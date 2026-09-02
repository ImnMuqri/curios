import { describe, expect, it } from 'vitest';
import { decideSettingsBanner, decideSettingsView } from './settings.js';

describe('decideSettingsView', () => {
  it('offers to add a password for a Google-only account', () => {
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: false, providers: ['GOOGLE'] });

    expect(view.showAddPassword).toBe(true);
    expect(view.showConnectGoogle).toBe(false);
    expect(view.email).toBe('nadia@example.com');
  });

  it('offers to connect Google for a password-only account', () => {
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: true, providers: [] });

    expect(view.showAddPassword).toBe(false);
    expect(view.showConnectGoogle).toBe(true);
  });

  it('offers neither form to an account that already has both', () => {
    // Empty states are instructions, not moods -- an account with both must
    // still be told something useful, not shown a blank screen.
    const view = decideSettingsView({ email: 'nadia@example.com', hasPassword: true, providers: ['GOOGLE'] });

    expect(view.showAddPassword).toBe(false);
    expect(view.showConnectGoogle).toBe(false);
  });
});

describe('decideSettingsBanner', () => {
  it('says nothing when there is nothing to report', () => {
    expect(decideSettingsBanner({})).toBeNull();
  });

  it('confirms a successful Google link', () => {
    expect(decideSettingsBanner({ linked: 'google' })).toEqual({ kind: 'linked' });
  });

  it('explains an already-linked identity using the API sentence, not an invented one', () => {
    // C2: the callback can only carry a CODE back on the redirect, not the
    // API's own message text -- that is lost the moment this became a
    // redirect instead of a JSON body. This screen owns turning the code back
    // into something a person can read.
    const banner = decideSettingsBanner({ error: 'identity_taken' });

    expect(banner).toMatchObject({ kind: 'error' });
    expect(banner && 'message' in banner ? banner.message : '').toMatch(/already connected/i);
  });

  it('falls back to a generic message for a code it does not recognise', () => {
    const banner = decideSettingsBanner({ error: 'something_new' });

    expect(banner).toMatchObject({ kind: 'error' });
    expect(banner && 'message' in banner ? banner.message : '').toMatch(/try again/i);
  });
});

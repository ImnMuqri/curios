import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from './oauth-errors.js';

describe('oauthErrorMessage', () => {
  it('explains an already-linked identity using the API sentence', () => {
    expect(oauthErrorMessage('identity_taken')).toMatch(/already connected/i);
  });

  it('explains a session that ended mid-link', () => {
    expect(oauthErrorMessage('unauthenticated')).toMatch(/session ended/i);
  });

  it('explains an expired or reused connection attempt', () => {
    expect(oauthErrorMessage('oauth_state_mismatch')).toMatch(/no longer valid/i);
  });

  it('explains an unverified Google email', () => {
    expect(oauthErrorMessage('email_not_verified')).toMatch(/no verified email/i);
  });

  it('does not promise a retry will help for a server fault', () => {
    // D1: OAuthExchangeError is a 502 precisely because retrying does not fix
    // a wrong client secret or an outage at Google -- see its comment in
    // apps/api/src/modules/auth/oauth.service.ts. This message must not
    // repeat the mistake `oauth_exchange_failed`'s old message made.
    const message = oauthErrorMessage('internal_error');

    expect(message).not.toMatch(/try again/i);
  });

  it('falls back to a generic sentence for a code it does not recognise', () => {
    expect(oauthErrorMessage('something_nobody_has_seen_before')).toMatch(/try again/i);
  });
});

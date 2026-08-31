import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginGoogleSignIn, exchangeGoogleCode, OAuthStateError } from './oauth.service.js';

describe('beginGoogleSignIn', () => {
  it('sends a challenge derived from a verifier it keeps', () => {
    const { url, verifier } = beginGoogleSignIn();
    const challenge = new URL(url).searchParams.get('code_challenge');

    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never sends the verifier itself', () => {
    const { url, verifier } = beginGoogleSignIn();

    // The whole point of PKCE: an intercepted authorize request must not
    // contain the secret needed to redeem the code.
    expect(url).not.toContain(verifier);
  });

  it('produces a fresh state each time', () => {
    expect(beginGoogleSignIn().state).not.toBe(beginGoogleSignIn().state);
  });
});

describe('exchangeGoogleCode', () => {
  const profile = { sub: 'g-1', email: 'nadia@example.com', emailVerified: true, name: 'Nadia' };
  const exchange = async () => profile;

  it('rejects a callback whose state does not match the cookie', async () => {
    await expect(
      exchangeGoogleCode(
        { code: 'c', state: 'from-the-url', cookieState: 'from-the-browser', verifier: 'v' },
        exchange,
      ),
    ).rejects.toBeInstanceOf(OAuthStateError);
  });

  it('rejects a callback with no state cookie at all', async () => {
    await expect(
      exchangeGoogleCode({ code: 'c', state: 's', cookieState: undefined, verifier: 'v' }, exchange),
    ).rejects.toBeInstanceOf(OAuthStateError);
  });

  it('returns the profile when the state matches', async () => {
    const result = await exchangeGoogleCode(
      { code: 'c', state: 'same', cookieState: 'same', verifier: 'v' },
      exchange,
    );

    expect(result).toEqual(profile);
  });
});

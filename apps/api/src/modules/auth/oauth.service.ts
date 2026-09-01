import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { GoogleProfile } from './auth.service.js';

export const OAUTH_STATE_COOKIE = 'curios_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'curios_oauth_verifier';

/**
 * Set only by `GET /auth/google/link`, which requires a session. Its presence
 * on the callback is what turns that one endpoint from a sign-in into a link.
 *
 * Signed, like the state and verifier, so planting it is not enough to change
 * which branch the callback takes.
 */
export const OAUTH_LINK_COOKIE = 'curios_oauth_link';

export class OAuthStateError extends Error {
  readonly statusCode = 400;
  readonly code = 'OAUTH_STATE_MISMATCH';

  constructor() {
    super('That sign-in link is no longer valid. Try again.');
    this.name = 'OAuthStateError';
  }
}

/**
 * Google answered, but not with a token, and not because the code was bad.
 *
 * A wrong client secret or redirect URI lands here. Kept apart from
 * OAuthStateError so it surfaces as a 5xx and is logged, instead of telling
 * every user their link expired while leaving nothing behind to diagnose.
 */
export class OAuthExchangeError extends Error {
  readonly statusCode = 502;
  readonly code = 'OAUTH_EXCHANGE_FAILED';

  constructor(status: number) {
    super(`Google's token endpoint answered ${status}.`);
    this.name = 'OAuthExchangeError';
  }
}

export type CodeExchange = (input: { code: string; verifier: string }) => Promise<GoogleProfile>;

/** Google's response, parsed at the boundary rather than trusted. */
const idTokenPayload = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

export function beginGoogleSignIn(): { url: string; state: string; verifier: string } {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { url: url.toString(), state, verifier };
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchangeGoogleCode(
  input: { code: string; state: string; cookieState: string | undefined; verifier: string },
  exchange: CodeExchange = redeemWithGoogle,
): Promise<GoogleProfile> {
  if (!input.cookieState || !sameState(input.state, input.cookieState)) {
    throw new OAuthStateError();
  }

  return exchange({ code: input.code, verifier: input.verifier });
}

async function redeemWithGoogle(input: { code: string; verifier: string }): Promise<GoogleProfile> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }),
  });

  // A 400 is Google rejecting the code itself -- expired, replayed, or not
  // ours -- which is the caller's problem and reads correctly as an invalid
  // link. Anything else is our configuration or Google's availability, and
  // must not present to every user as an expired link.
  if (response.status === 400) throw new OAuthStateError();
  if (!response.ok) throw new OAuthExchangeError(response.status);

  const body = z.object({ id_token: z.string().min(1) }).parse(await response.json());
  const [, payload] = body.id_token.split('.');
  const claims = idTokenPayload.parse(
    JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
  );

  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified ?? false,
    name: claims.name,
  };
}

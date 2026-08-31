import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { GoogleProfile } from './auth.service.js';

export const OAUTH_STATE_COOKIE = 'curios_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'curios_oauth_verifier';

export class OAuthStateError extends Error {
  readonly statusCode = 400;
  readonly code = 'OAUTH_STATE_MISMATCH';

  constructor() {
    super('That sign-in link is no longer valid. Try again.');
    this.name = 'OAuthStateError';
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

  if (!response.ok) throw new OAuthStateError();

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

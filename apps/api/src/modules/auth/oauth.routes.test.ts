import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { SESSION_COOKIE } from './session.service.js';
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from './oauth.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

const SUB = `g-${randomUUID()}`;
const EMAIL = `oauth-${randomUUID()}@example.com`;

beforeAll(async () => {
  app = await buildApp({
    auth: {
      // Injected for the same reason the breach fetcher is: the real exchange
      // posts to Google's token endpoint, and a test that reaches a third party
      // is a test that fails offline and shows them our suite.
      exchange: async () => ({ sub: SUB, email: EMAIL, emailVerified: true, name: 'Nadia' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /auth/google', () => {
  it('sends the browser to Google and keeps the verifier in a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google', remoteAddress: from() });

    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers.location as string);
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');

    const state = res.cookies.find((c) => c.name === OAUTH_STATE_COOKIE);
    const verifier = res.cookies.find((c) => c.name === OAUTH_VERIFIER_COOKIE);
    expect(state?.httpOnly).toBe(true);
    expect(verifier?.httpOnly).toBe(true);

    // The verifier stays with the browser; only its hash goes to Google. If
    // these two ever match, PKCE is doing nothing.
    expect(target.searchParams.get('code_challenge')).not.toBe(verifier?.value);

    // And what goes out is signed. The state in the URL is the bare value,
    // so a cookie carrying that same bare value never came from here.
    const stateInUrl = target.searchParams.get('state');
    expect(state?.value).not.toBe(stateInUrl);
    expect(app.unsignCookie(state?.value ?? '')).toMatchObject({
      valid: true,
      value: stateInUrl,
    });
  });
});

describe('GET /auth/google/callback', () => {
  it('refuses a callback whose state does not match the cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=abc&state=from-the-url',
      remoteAddress: from(),
      cookies: { [OAUTH_STATE_COOKIE]: 'a-different-state', [OAUTH_VERIFIER_COOKIE]: 'v' },
    });

    // This is the whole reason state exists: an attacker feeding the victim a
    // code obtained for the attacker's own Google account. A session issued
    // here signs the victim in as someone else.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('OAUTH_STATE_MISMATCH');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('refuses a callback carrying no state cookie at all', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=abc&state=anything',
      remoteAddress: from(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('signs in and issues a session when the state matches', async () => {
    const state = 'a-state-this-browser-started-with';

    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
      remoteAddress: from(),
      cookies: {
        [OAUTH_STATE_COOKIE]: app.signCookie(state),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('the-verifier'),
      },
    });

    expect(res.statusCode).toBe(302);
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(session?.httpOnly).toBe(true);

    // The one-time cookies are spent, not left behind for a replay.
    expect(res.cookies.find((c) => c.name === OAUTH_STATE_COOKIE)?.value).toBe('');
    expect(res.cookies.find((c) => c.name === OAUTH_VERIFIER_COOKIE)?.value).toBe('');

    const account = await app.prisma.account.findUnique({ where: { email: EMAIL } });
    expect(account).not.toBeNull();

    // And the session is real: it resolves on a subsequent request.
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: session?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
  });
});

describe('the callback under conditions that are not the happy path', () => {
  it('refuses a state cookie that this server did not sign', async () => {
    const planted = 'a-state-an-attacker-chose';

    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${planted}`,
      remoteAddress: from(),
      // Unsigned, which is all a cookie-injection foothold can produce: a
      // subdomain XSS or takeover can set cookies on the parent domain but
      // cannot forge this server's signature. Without signing, planting a
      // cookie that matches a state of one's own choosing is enough to log a
      // victim in as the attacker.
      cookies: { [OAUTH_STATE_COOKIE]: planted, [OAUTH_VERIFIER_COOKIE]: 'v' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('sends someone who cancelled at Google back to the app, not to raw JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied&state=whatever',
      remoteAddress: from(),
      cookies: { [OAUTH_STATE_COOKIE]: app.signCookie('whatever') },
    });

    // Clicking Cancel is an ordinary thing to do. Answering it with a 400 and
    // a validation message on the API origin is a dead end with no way back.
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/');
    expect(res.json).toBeDefined();
  });

  it('spends the one-time cookies even when the callback fails', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=abc&state=does-not-match',
      remoteAddress: from(),
      cookies: {
        [OAUTH_STATE_COOKIE]: app.signCookie('something-else'),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
      },
    });

    expect(res.statusCode).toBe(400);
    // Otherwise a failed attempt leaves a usable state and verifier sitting in
    // the browser for the rest of their ten minutes.
    expect(res.cookies.find((c) => c.name === OAUTH_STATE_COOKIE)?.value).toBe('');
    expect(res.cookies.find((c) => c.name === OAUTH_VERIFIER_COOKIE)?.value).toBe('');
  });
});

describe('the credential limiters and the OAuth start', () => {
  it('does not halve the per-IP budget on a route that carries no email', async () => {
    // The per-email limiter keys on the body's email and falls back to the
    // caller's address when there is none. On a bodyless route that makes it a
    // second, stricter per-IP limiter: 10 instead of the intended 20. Behind
    // one office NAT or a carrier's CGNAT that is ten sign-in attempts for
    // everybody, which is a lockout dressed as abuse protection.
    const shared = '198.51.100.90';
    const codes: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google',
        remoteAddress: shared,
      });
      codes.push(res.statusCode);
    }

    expect(codes.filter((c) => c === 429)).toHaveLength(0);
  });
});

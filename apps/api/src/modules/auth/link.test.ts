import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from './session.service.js';
import { hashPassword } from './password.service.js';
import { OAUTH_LINK_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from './oauth.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

// One sub per test, not one per file. Sharing it silently couples the linking
// tests: whichever runs first claims the sub, and every later test's "first"
// link is really a collision with that one. A test can then pass for a reason
// its own narrative never mentions.
let currentSub = `link-${randomUUID()}`;
const freshSub = () => (currentSub = `link-${randomUUID()}`);
const PASSWORD = 'a-long-enough-passphrase';

beforeAll(async () => {
  app = await buildApp({
    auth: {
      exchange: async () => ({
        sub: currentSub,
        email: `google-${randomUUID()}@example.com`,
        emailVerified: true,
        name: 'Nadia',
      }),
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anAccount(withPassword: boolean): Promise<{ id: string; cookie: string }> {
  const account = await app.prisma.account.create({
    data: {
      email: `link-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      ...(withPassword ? { password: { create: { hash: await hashPassword(PASSWORD) } } } : {}),
    },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { id: account.id, cookie: value };
}

describe('POST /auth/password', () => {
  it('adds a password to an account that has none', async () => {
    const account = await anAccount(false);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: {
        email: (await app.prisma.account.findUnique({ where: { id: account.id } }))?.email,
        password: PASSWORD,
      },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      payload: { password: PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });

  it('refuses to overwrite a password that already exists', async () => {
    const account = await anAccount(true);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: 'an-entirely-different-passphrase' },
    });

    // Changing a password is the reset flow, which proves control of the
    // inbox. Letting a session alone rewrite it means a stolen session
    // becomes permanent ownership.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PASSWORD_ALREADY_SET');
  });

  it('screens the new password like signup does', async () => {
    const account = await anAccount(false);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: 'sh0rt' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
  });
});

describe('linking Google while signed in', () => {
  it('attaches the identity to the account already signed in', async () => {
    const sub = freshSub();
    const account = await anAccount(true);
    const state = 'a-state-this-browser-started-with';

    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
      remoteAddress: from(),
      cookies: {
        [SESSION_COOKIE]: account.cookie,
        [OAUTH_LINK_COOKIE]: app.signCookie('1'),
        [OAUTH_STATE_COOKIE]: app.signCookie(state),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
      },
    });

    expect(res.statusCode).toBe(302);
    const identity = await app.prisma.authIdentity.findFirst({
      where: { provider: 'GOOGLE', providerUserId: sub },
      select: { accountId: true },
    });
    // Attached to the signed-in account, and no second account created.
    expect(identity?.accountId).toBe(account.id);
  });

  it('creates no account and links nothing when the link cookie arrives without a session', async () => {
    const state = 'another-state';

    const before = await app.prisma.account.count();
    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
      remoteAddress: from(),
      cookies: {
        [OAUTH_LINK_COOKIE]: app.signCookie('1'),
        [OAUTH_STATE_COOKIE]: app.signCookie(state),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
      },
    });

    // A link intent with nothing to link to must not quietly become a signup.
    // That is the branch where "explicit and authenticated" would be lost.
    // And -- C2 -- the browser here is mid-redirect-chain back from Google,
    // so this must redirect to the app rather than dead-end as JSON on the
    // API origin.
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/app/settings?error=unauthenticated');
    expect(await app.prisma.account.count()).toBe(before);
  });

  it('is idempotent when the same owner links twice', async () => {
    const sub = freshSub();
    const account = await anAccount(true);
    const state = 'a-second-click';

    const link = () =>
      app.inject({
        method: 'GET',
        url: `/auth/google/callback?code=abc&state=${state}`,
        remoteAddress: from(),
        cookies: {
          [SESSION_COOKIE]: account.cookie,
          [OAUTH_LINK_COOKIE]: app.signCookie('1'),
          [OAUTH_STATE_COOKIE]: app.signCookie(state),
          [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
        },
      });

    expect((await link()).statusCode).toBe(302);
    // A second click is an ordinary thing to do, and must not be reported as
    // "already connected to another account". Without this test the
    // same-account early return is exercised by nothing at all, and deleting
    // it would fail no test in the suite.
    expect((await link()).statusCode).toBe(302);

    const identities = await app.prisma.authIdentity.findMany({
      where: { provider: 'GOOGLE', providerUserId: sub },
    });
    expect(identities).toHaveLength(1);
    expect(identities[0]?.accountId).toBe(account.id);
  });

  it('refuses to move an identity that already belongs to another account', async () => {
    freshSub();
    const first = await anAccount(true);
    const second = await anAccount(true);
    const state = 'shared-state';

    const link = (cookie: string) =>
      app.inject({
        method: 'GET',
        url: `/auth/google/callback?code=abc&state=${state}`,
        remoteAddress: from(),
        cookies: {
          [SESSION_COOKIE]: cookie,
          [OAUTH_LINK_COOKIE]: app.signCookie('1'),
          [OAUTH_STATE_COOKIE]: app.signCookie(state),
          [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
        },
      });

    await link(first.cookie);
    const res = await link(second.cookie);

    // Otherwise linking is a way to take an identity off someone else's
    // account, which is the takeover the explicit-linking rule exists to stop.
    //
    // C2: the browser here followed a redirect chain back from Google, so a
    // thrown 409 would render as raw JSON at the API origin -- no
    // navigation, no way back. This must redirect to the app instead, with
    // the reason as a query code rather than a body nothing on this page
    // reads.
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/app/settings?error=identity_taken');
  });
});

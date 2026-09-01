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

const SUB = `link-${randomUUID()}`;
const PASSWORD = 'a-long-enough-passphrase';

beforeAll(async () => {
  app = await buildApp({
    auth: {
      exchange: async () => ({
        sub: SUB,
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
      where: { provider: 'GOOGLE', providerUserId: SUB },
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
    expect(res.statusCode).toBe(401);
    expect(await app.prisma.account.count()).toBe(before);
  });

  it('refuses to move an identity that already belongs to another account', async () => {
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
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IDENTITY_TAKEN');
  });
});

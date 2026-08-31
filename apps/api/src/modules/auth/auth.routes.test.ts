import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { SESSION_COOKIE } from './session.service.js';
import { hashPassword } from './password.service.js';

let app: FastifyInstance;

const GOOD_PASSWORD = 'a-long-enough-passphrase';

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** Records what was sent instead of reaching a real SMTP server. */
const sent: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  app = await buildApp({
    auth: {
      mailer: {
        async send(message: { to: string; subject: string; text: string }) {
          sent.push(message);
        },
      },
      // No request leaves the suite: HIBP is a third party, and a test that
      // depends on its uptime is a test that fails on a train.
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function aVerifiedAccountWithPassword(): Promise<string> {
  const email = `login-${randomUUID()}@example.com`;
  await app.prisma.account.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      password: { create: { hash: await hashPassword(GOOD_PASSWORD) } },
    },
  });
  return email;
}

describe('POST /auth/signup', () => {
  it('accepts a new address and issues no session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `new-${randomUUID()}@example.com`, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(202);
    // An unverified account must not be usable. Issuing a session here is the
    // takeover: sign up as someone else's address and you are already inside.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers identically for an address that already has an account', async () => {
    const email = await aVerifiedAccountWithPassword();

    const taken = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });
    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `other-${randomUUID()}@example.com`, password: GOOD_PASSWORD },
    });

    // The form must not be usable to discover who has an account.
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.body).toBe(fresh.body);
  });

  it('writes no second account for an address that already has one', async () => {
    const email = await aVerifiedAccountWithPassword();

    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(await app.prisma.account.count({ where: { email } })).toBe(1);
  });

  it('re-sends the verification link to an unverified address, rather than telling it to sign in', async () => {
    // The F2 trap: a signup whose mail failed after the account was written
    // leaves someone who cannot sign in (unverified) and cannot start over
    // (address taken). Telling them to sign in strands them, so the retry has
    // to re-send the link. Only the mail differs -- the HTTP response is
    // identical either way, which the enumeration test above pins down.
    const email = `retry-${randomUUID()}@example.com`;
    await app.prisma.account.create({
      data: { email, password: { create: { hash: await hashPassword(GOOD_PASSWORD) } } },
    });
    sent.length = 0;

    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(email);
    expect(sent[0]?.subject).toBe('Confirm your email');
    expect(sent[0]?.text).toContain('/verify?token=');
  });

  it('rejects a password shorter than the minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `short-${randomUUID()}@example.com`, password: 'sh0rt' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('issues an httpOnly session cookie for the right password', async () => {
    const email = await aVerifiedAccountWithPassword();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const email = await aVerifiedAccountWithPassword();

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: 'not-the-right-password' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: `ghost-${randomUUID()}@example.com`, password: 'not-the-right-password' },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('refuses an account whose address is not verified', async () => {
    const email = `unverified-${randomUUID()}@example.com`;
    await app.prisma.account.create({
      data: { email, password: { create: { hash: await hashPassword(GOOD_PASSWORD) } } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('makes the session immediately unusable', async () => {
    const email = await aVerifiedAccountWithPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });
    const value = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: value },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/auth/me',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: value },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('the credential limiters cover credentials, and only credentials', () => {
  it('does not spend the credential budget on session checks', async () => {
    const email = await aVerifiedAccountWithPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });
    const value = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    // One address, as a real browser is. The dashboard checks the session on
    // every navigation, so putting /auth/me on a 20-per-15-minutes credential
    // budget signs people out for browsing.
    const polling = '198.51.100.7';
    const codes = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        remoteAddress: polling,
        cookies: { [SESSION_COOKIE]: value },
      });
      codes.add(res.statusCode);
    }

    expect([...codes]).toEqual([200]);
  });

  it('does not let signup attempts lock an address out of login', async () => {
    const email = await aVerifiedAccountWithPassword();

    // Unauthenticated, and from anywhere. If these share a bucket with login,
    // anyone can lock anyone out of their own account by posting signups.
    for (let i = 0; i < 12; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        remoteAddress: from(),
        payload: { email, password: GOOD_PASSWORD },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
  });

  it('clears the session cookie on the domain it was set on', async () => {
    process.env.COOKIE_DOMAIN = '.curios.test';
    try {
      const email = await aVerifiedAccountWithPassword();
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: from(),
        payload: { email, password: GOOD_PASSWORD },
      });
      const value = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
      expect(login.cookies.find((c) => c.name === SESSION_COOKIE)?.domain).toBe('.curios.test');

      const out = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        remoteAddress: from(),
        cookies: { [SESSION_COOKIE]: value },
      });

      // A clear with no Domain does not replace a cookie scoped to one, so the
      // browser keeps sending the old value at every subdomain.
      expect(out.cookies.find((c) => c.name === SESSION_COOKIE)?.domain).toBe('.curios.test');
    } finally {
      delete process.env.COOKIE_DOMAIN;
    }
  });
});

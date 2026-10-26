import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { SESSION_COOKIE } from './session.service.js';
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from './oauth.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

const sent: Array<{ to: string; subject: string }> = [];
/** Whom Google says signed in: set per test. */
let profile = { sub: '', email: '', emailVerified: true, name: 'Nadia' };

/** The switch as the admin's route stores it, then the cache cleared, as that route does. */
async function signupsSwitch(on: boolean) {
  await app.prisma.systemSetting.upsert({ where: { key: 'switch.signups' }, create: { key: 'switch.signups', value: on }, update: { value: on } });
  app.settings.clear();
}

beforeAll(async () => {
  app = await buildApp({
    auth: {
      mailer: {
        async send(message) {
          sent.push(message);
        },
      },
      fetcher: async () => ({ ok: true, text: async () => '' }),
      exchange: async () => profile,
    },
  });
  await app.ready();
});

afterAll(async () => {
  // SystemSetting is reached by no truncate cascade: this suite removes its own row.
  await app.prisma.systemSetting.deleteMany({ where: { key: 'switch.signups' } });
  await app.close();
});

beforeEach(async () => {
  sent.length = 0;
  profile = { sub: `g-${randomUUID()}`, email: `sw-${randomUUID()}@example.com`, emailVerified: true, name: 'Nadia' };
  await signupsSwitch(true);
});

const signUp = (email: string) =>
  app.inject({ method: 'POST', url: '/auth/signup', remoteAddress: from(), payload: { email, password: 'a-long-enough-passphrase' } });

function googleCallback() {
  const state = `state-${randomUUID()}`;
  return app.inject({
    method: 'GET',
    url: `/auth/google/callback?code=abc&state=${state}`,
    remoteAddress: from(),
    cookies: { [OAUTH_STATE_COOKIE]: app.signCookie(state), [OAUTH_VERIFIER_COOKIE]: app.signCookie('the-verifier') },
  });
}

describe('the sign-ups switch', () => {
  it('off: an email sign-up is a 503 that says Curios is full, and writes and mails nothing', async () => {
    await signupsSwitch(false);
    const email = `sw-${randomUUID()}@example.com`;
    const res = await signUp(email);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toEqual({ code: 'SIGNUPS_CLOSED', message: 'Curios is full for now. Try again soon.' });
    expect(await app.prisma.account.count({ where: { email } })).toBe(0);
    expect(sent).toEqual([]);
  });

  it('off: Google for a new person goes back to the sign-up page, closed, with no account and no session', async () => {
    await signupsSwitch(false);
    const res = await googleCallback();
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/signup?closed=1');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(await app.prisma.authIdentity.count({ where: { providerUserId: profile.sub } })).toBe(0);
  });

  it('off: someone who already has a Google account signs in as usual', async () => {
    await googleCallback();
    await signupsSwitch(false);
    const res = await googleCallback();
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/app');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined();
  });

  it('back on: both sign-ups make an account again', async () => {
    await signupsSwitch(false);
    await signupsSwitch(true);
    const email = `sw-${randomUUID()}@example.com`;
    expect((await signUp(email)).statusCode).toBe(202);
    expect(await app.prisma.account.count({ where: { email } })).toBe(1);

    const res = await googleCallback();
    expect(res.headers.location).toBe('http://localhost:3000/app');
    expect(await app.prisma.authIdentity.count({ where: { providerUserId: profile.sub } })).toBe(1);
  });
});

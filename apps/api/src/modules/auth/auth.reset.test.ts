import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { hashPassword } from './password.service.js';
import { issueToken } from './token.service.js';
import { createSession, SESSION_COOKIE } from './session.service.js';

let app: FastifyInstance;
const PASSWORD = 'a-long-enough-passphrase';
const NEW_PASSWORD = 'an-entirely-different-passphrase';

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
      // resetPassword screens the new password against Have I Been Pwned. Left
      // to the default fetcher this file would make a real outbound request per
      // reset, which is slow, fails offline, and shows a third party the suite.
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anAccount(verified: boolean): Promise<{ id: string; email: string }> {
  const email = `reset-${randomUUID()}@example.com`;
  const account = await app.prisma.account.create({
    data: {
      email,
      emailVerifiedAt: verified ? new Date() : null,
      password: { create: { hash: await hashPassword(PASSWORD) } },
    },
    select: { id: true },
  });
  return { id: account.id, email };
}

const tokenFrom = (text: string): string => text.match(/token=([^\s]+)/)?.[1] ?? '';

describe('POST /auth/verify-email', () => {
  it('marks the address verified and lets the account sign in', async () => {
    const account = await anAccount(false);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: account.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a token that has already been used', async () => {
    const account = await anAccount(false);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');
    await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
  });
});

describe('POST /auth/forgot-password', () => {
  it('answers identically for a known and an unknown address', async () => {
    const account = await anAccount(true);

    const known = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: `ghost-${randomUUID()}@example.com` },
    });

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.body).toBe(unknown.body);
  });

  it('supersedes an earlier reset link when a newer one is requested', async () => {
    const account = await anAccount(true);
    sent.length = 0;

    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });

    const [first, second] = sent.map((m) => tokenFrom(m.text));
    expect(first).not.toBe(second);

    // Asking again is what someone does when the first link did not arrive, or
    // when they suspect the first request was not theirs. Leaving the earlier
    // link live for its full hour keeps an unwanted key to the account in an
    // inbox the owner may not control.
    const stale = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token: first, password: NEW_PASSWORD },
    });
    expect(stale.statusCode).toBe(400);

    const newest = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token: second, password: NEW_PASSWORD },
    });
    expect(newest.statusCode).toBe(200);
  });
});

describe('POST /auth/reset-password', () => {
  it('changes the password and lets the new one work', async () => {
    const account = await anAccount(true);
    const token = await issueToken(app.prisma, account.id, 'PASSWORD_RESET');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: account.email, password: NEW_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('revokes every existing session', async () => {
    const account = await anAccount(true);
    const existing = await createSession(app.prisma, account.id);
    const token = await issueToken(app.prisma, account.id, 'PASSWORD_RESET');

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });

    // A reset exists to end an intrusion. Leaving the intruder's session alive
    // defeats the entire point of the flow.
    const after = await app.inject({
      method: 'GET',
      url: '/auth/me',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: existing.value },
    });
    expect(after.statusCode).toBe(401);
  });

  it('refuses a verification token presented as a reset token', async () => {
    const account = await anAccount(true);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });

    // Otherwise a verification link in an inbox is a password reset.
    expect(res.statusCode).toBe(400);
  });
});

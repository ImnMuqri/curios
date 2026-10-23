import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE, hashSessionValue } from '@curios/core';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { SESSION_COOKIE, createSession } from '../auth/session.service.js';
import { createAdminSession } from './admin-session.service.js';

const PASSWORD = 'a-long-enough-passphrase';

let app: FastifyInstance;
let bare: FastifyInstance;
let previousOrigin: string | undefined;
const made: string[] = [];
const madeAccounts: string[] = [];

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `198.51.100.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp();
  await app.ready();

  delete process.env.ADMIN_ORIGIN;
  bare = await buildApp();
  await bare.ready();
});

afterAll(async () => {
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  // AdminAction restricts deletion of its admin, so the audit rows go first (tests only).
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: { in: made } } });
  await app.prisma.adminUser.deleteMany({ where: { id: { in: made } } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
  await bare.close();
});

async function anAdmin(extra: { disabledAt?: Date } = {}) {
  const email = `admin-${randomUUID()}@example.com`;
  const admin = await app.prisma.adminUser.create({
    data: { email, name: 'Test Admin', passwordHash: await hashPassword(PASSWORD), ...extra },
  });
  made.push(admin.id);
  return admin;
}

function signin(email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/admin/signin',
    remoteAddress: from(),
    payload: { email, password },
  });
}

const adminCookie = (res: { cookies: Array<{ name: string; value: string }> }) =>
  res.cookies.find((c) => c.name === ADMIN_COOKIE)?.value ?? '';

describe('POST /admin/signin', () => {
  it('signs in with the right password, sets curios_admin and writes SIGNED_IN', async () => {
    const admin = await anAdmin();
    const res = await signin(admin.email, PASSWORD);

    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === ADMIN_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', maxAge: 28800, path: '/' });

    const session = await app.prisma.adminSession.findUnique({
      where: { id: hashSessionValue(cookie!.value) },
    });
    expect(session?.adminUserId).toBe(admin.id);

    const audit = await app.prisma.adminAction.findMany({ where: { adminUserId: admin.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'SIGNED_IN', targetType: 'AdminUser', targetId: admin.id });
    const after = await app.prisma.adminUser.findUnique({ where: { id: admin.id } });
    expect(after?.lastLoginAt).not.toBeNull();
  });

  it('says the same thing for an unknown email, a wrong password and a disabled admin', async () => {
    const live = await anAdmin();
    const disabled = await anAdmin({ disabledAt: new Date() });

    const bodies = [];
    for (const [email, password] of [
      [`nobody-${randomUUID()}@example.com`, PASSWORD],
      [live.email, 'not-the-password'],
      [disabled.email, PASSWORD],
    ] as const) {
      const res = await signin(email, password);
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      bodies.push(res.json());
    }

    for (const body of bodies) {
      expect(body).toEqual({ error: { code: 'ADMIN_SIGNIN_FAILED', message: 'Wrong email or password.' } });
    }
  });
});

describe('GET /admin/me', () => {
  it('answers 401 with no cookie, 401 with an owner session and 200 with an admin one', async () => {
    const none = await app.inject({ method: 'GET', url: '/admin/me' });
    expect(none.statusCode).toBe(401);

    const account = await app.prisma.account.create({
      data: { email: `owner-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    });
    madeAccounts.push(account.id);
    const owner = await createSession(app.prisma, account.id);
    const asOwner = await app.inject({
      method: 'GET',
      url: '/admin/me',
      cookies: { [SESSION_COOKIE]: owner.value },
    });
    expect(asOwner.statusCode).toBe(401);

    const admin = await anAdmin();
    const value = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
    const ok = await app.inject({ method: 'GET', url: '/admin/me', cookies: { [ADMIN_COOKIE]: value } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: admin.id, name: 'Test Admin', email: admin.email });
  });

  it('refuses a session past 8 hours and a disabled admin', async () => {
    const admin = await anAdmin();
    const value = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
    await app.prisma.adminSession.update({
      where: { id: hashSessionValue(value) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({ method: 'GET', url: '/admin/me', cookies: { [ADMIN_COOKIE]: value } });
    expect(res.statusCode).toBe(401);

    const other = await anAdmin();
    const live = await createAdminSession(app.prisma, other.id, '127.0.0.1');
    await app.prisma.adminUser.update({ where: { id: other.id }, data: { disabledAt: new Date() } });
    const gone = await app.inject({ method: 'GET', url: '/admin/me', cookies: { [ADMIN_COOKIE]: live } });
    expect(gone.statusCode).toBe(401);
  });
});

describe('owner routes', () => {
  it('an owner route given only curios_admin answers 401', async () => {
    const admin = await anAdmin();
    const value = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
    const res = await app.inject({ method: 'GET', url: '/auth/me', cookies: { [ADMIN_COOKIE]: value } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /admin/signout', () => {
  it('ends the session', async () => {
    const admin = await anAdmin();
    const value = adminCookie(await signin(admin.email, PASSWORD));

    const out = await app.inject({ method: 'POST', url: '/admin/signout', cookies: { [ADMIN_COOKIE]: value } });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/admin/me', cookies: { [ADMIN_COOKIE]: value } });
    expect(after.statusCode).toBe(401);
  });
});

describe('without ADMIN_ORIGIN', () => {
  it('has no /admin routes and still answers /health', async () => {
    expect((await bare.inject({ method: 'GET', url: '/admin/me' })).statusCode).toBe(404);
    expect((await bare.inject({ method: 'POST', url: '/admin/signin', payload: {} })).statusCode).toBe(404);
    expect((await bare.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('CORS', () => {
  const preflight = (a: FastifyInstance, url: string, origin: string) =>
    a.inject({
      method: 'OPTIONS',
      url,
      headers: { origin, 'access-control-request-method': 'POST', 'x-forwarded-for': from() },
    });

  it('allows the admin origin on /admin routes', async () => {
    const res = await preflight(app, '/admin/signin', 'http://localhost:3002');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3002');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow the admin origin on owner routes', async () => {
    const res = await preflight(app, '/auth/me', 'http://localhost:3002');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still allows the owner app on owner routes', async () => {
    const res = await preflight(app, '/auth/me', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows no admin origin anywhere when ADMIN_ORIGIN is unset', async () => {
    const res = await preflight(bare, '/admin/signin', 'http://localhost:3002');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

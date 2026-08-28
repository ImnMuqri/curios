import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createSession, SESSION_COOKIE } from '../modules/auth/session.service.js';
import { buildApp } from '../app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('requireSession', () => {
  it('rejects a request with no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a cookie that was never issued', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: 'forged-value' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('admits a live session and names the account', async () => {
    const account = await app.prisma.account.create({
      data: { email: `plugin-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const { value } = await createSession(app.prisma, account.id);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: value },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accountId: account.id });
  });
});

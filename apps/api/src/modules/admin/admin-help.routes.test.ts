import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE } from '@curios/core';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
let accountId: string;
const rows: string[] = [];

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ admin: { store: null } });
  await app.ready();
  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: { email: `ah-${slug}@example.com`, pages: { create: { handle: `ah-${slug}`, skeleton: `ah-${slug}`, displayName: 'Kek Lina' } } },
  });
  accountId = account.id;
});

afterAll(async () => {
  await app.prisma.helpQuestion.deleteMany({ where: { id: { in: rows } } });
  await app.prisma.account.deleteMany({ where: { id: accountId } });
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

const at = (minutes: number) => new Date(Date.parse('2099-01-01T00:00:00Z') + minutes * 60_000);

describe('GET /admin/help/misses', () => {
  it('refuses a caller who is not an admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/help/misses' })).statusCode).toBe(401);
  });

  it('lists, newest first, the questions not in the guide and the answers marked No, with whose they were', async () => {
    const made = await Promise.all(
      [
        { question: 'own domain?', via: 'CHAT' as const, entryId: null, createdAt: at(1) },
        { question: 'how much?', via: 'CHAT' as const, entryId: 'bill-price', helped: false, sentToSupport: true, createdAt: at(2) },
        { question: 'dark mode?', via: 'CHAT' as const, entryId: 'acc-dark', helped: true, createdAt: at(3) },
        { question: 'resting', via: 'CHAT' as const, entryId: null, ok: false, createdAt: at(4) },
        { question: null, via: 'CHAT' as const, entryId: null, createdAt: at(5) },
      ].map((data) => app.prisma.helpQuestion.create({ data: { accountId, screen: 'billing', ...data }, select: { id: true } })),
    );
    rows.push(...made.map((r) => r.id));

    const res = await app.inject({ method: 'GET', url: '/admin/help/misses', cookies: { [ADMIN_COOKIE]: cookie } });
    expect(res.statusCode).toBe(200);
    type Miss = { id: string; question: string; entry: unknown; sentToSupport: boolean; owner: unknown };
    const mine = res.json<{ misses: Miss[] }>().misses.filter((m) => rows.includes(m.id));
    expect(mine.map((m) => m.question)).toEqual(['how much?', 'own domain?']);
    expect(mine[0]).toMatchObject({ entry: { id: 'bill-price', question: 'How much is Business?' }, sentToSupport: true, owner: { email: expect.stringMatching(/^ah-/), handle: expect.stringMatching(/^ah-/) } });
    expect(mine[1]!.entry).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getAdminSession } from './session.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let live = '';
let expired = '';
let disabled = '';

async function aSession(options: { expiresAt: Date; disabledAt?: Date }): Promise<string> {
  const value = randomUUID();
  const admin = await write.adminUser.create({
    data: { email: `s-${randomUUID()}@curios.test`, name: 'Sess Admin', passwordHash: 'x', disabledAt: options.disabledAt ?? null },
  });
  await write.adminSession.create({ data: { id: hashSessionValue(value), adminUserId: admin.id, expiresAt: options.expiresAt, ip: '127.0.0.1' } });
  return value;
}

beforeAll(async () => {
  live = await aSession({ expiresAt: new Date(Date.now() + 3_600_000) });
  expired = await aSession({ expiresAt: new Date(Date.now() - 1000) });
  disabled = await aSession({ expiresAt: new Date(Date.now() + 3_600_000), disabledAt: new Date() });
});

afterAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "AdminUser" CASCADE');
  await write.$disconnect();
});

describe('getAdminSession', () => {
  it('returns who the live session belongs to', async () => {
    const session = await getAdminSession(live);
    expect(session).toMatchObject({ name: 'Sess Admin' });
    expect(session?.email).toMatch(/@curios\.test$/);
    expect(session?.adminUserId).toBeTruthy();
  });

  it('is null past expiresAt', async () => {
    expect(await getAdminSession(expired)).toBeNull();
  });

  it('is null for a disabled admin', async () => {
    expect(await getAdminSession(disabled)).toBeNull();
  });

  it('is null for a value that was never issued', async () => {
    expect(await getAdminSession('nope')).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hasRecentOwnerView } from './owner-view-log.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIN = 60_000;
let adminA = '';
let adminB = '';

const log = (adminUserId: string, targetId: string, createdAt: Date) =>
  write.adminAction.create({
    data: { adminUserId, action: 'VIEWED_AS_OWNER', targetType: 'Page', targetId, targetLabel: targetId, reason: 'Support', ip: '127.0.0.1', createdAt },
  });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "AdminUser" CASCADE');
  adminA = (await write.adminUser.create({ data: { email: `a-${randomUUID()}@curios.test`, name: 'A', passwordHash: 'x' } })).id;
  adminB = (await write.adminUser.create({ data: { email: `b-${randomUUID()}@curios.test`, name: 'B', passwordHash: 'x' } })).id;
  await log(adminA, 'page-1', new Date(NOW.getTime() - 5 * MIN));
  await log(adminA, 'page-old', new Date(NOW.getTime() - 20 * MIN));
});

afterAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "AdminUser" CASCADE');
  await write.$disconnect();
});

const since = new Date(NOW.getTime() - 15 * MIN);

describe('hasRecentOwnerView', () => {
  it('is true for a row inside the window', async () => {
    expect(await hasRecentOwnerView({ adminUserId: adminA, pageId: 'page-1', since })).toBe(true);
  });
  it('is false for a row older than the window', async () => {
    expect(await hasRecentOwnerView({ adminUserId: adminA, pageId: 'page-old', since })).toBe(false);
  });
  it('is false for another admin', async () => {
    expect(await hasRecentOwnerView({ adminUserId: adminB, pageId: 'page-1', since })).toBe(false);
  });
  it('is false for another page', async () => {
    expect(await hasRecentOwnerView({ adminUserId: adminA, pageId: 'page-2', since })).toBe(false);
  });
});

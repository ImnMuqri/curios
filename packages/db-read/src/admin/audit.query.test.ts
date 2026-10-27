import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getAuditLog } from './audit.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "AdminUser" CASCADE');
  const admin = await write.adminUser.create({ data: { email: `a-${randomUUID()}@curios.test`, name: 'Audit Admin', passwordHash: 'x' } });
  const row = (n: number, action: string) => ({
    adminUserId: admin.id,
    action,
    targetType: 'page',
    targetId: 'p1',
    targetLabel: `target ${n}`,
    reason: `reason ${n}`,
    ip: '127.0.0.1',
    createdAt: new Date(Date.UTC(2026, 9, 20, 10, n)),
  });
  await write.adminAction.createMany({ data: [row(1, 'SIGNED_IN'), row(3, 'SUSPENDED_PAGE'), row(2, 'GRANTED_MONTH')] });
});

afterAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "AdminUser" CASCADE');
  await write.$disconnect();
});

describe('getAuditLog', () => {
  it('lists newest first with the admin name', async () => {
    const rows = await getAuditLog();
    expect(rows.map((r) => r.action)).toEqual(['SUSPENDED_PAGE', 'GRANTED_MONTH', 'SIGNED_IN']);
    expect(rows[0]).toMatchObject({ adminName: 'Audit Admin', targetId: 'p1', targetLabel: 'target 3', reason: 'reason 3' });
  });

  it('honours limit', async () => {
    expect(await getAuditLog({ limit: 2 })).toHaveLength(2);
  });

  it('pages backwards with before', async () => {
    const rows = await getAuditLog({ before: new Date(Date.UTC(2026, 9, 20, 10, 3)) });
    expect(rows.map((r) => r.action)).toEqual(['GRANTED_MONTH', 'SIGNED_IN']);
  });
});

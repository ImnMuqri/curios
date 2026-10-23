import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@curios/db';
import { createOrResetAdmin } from './admin-user.service.js';
import { createAdminSession, validateAdminSession } from './admin-session.service.js';

const made: string[] = [];

afterAll(async () => {
  await prisma.adminUser.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

describe('createOrResetAdmin', () => {
  it('creates an admin that is not there yet', async () => {
    const email = `create-${randomUUID()}@example.com`;
    expect(await createOrResetAdmin(prisma, { email, name: 'New', passwordHash: 'h1' })).toBe('created');
    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    made.push(row.id);
    expect(row).toMatchObject({ name: 'New', passwordHash: 'h1', disabledAt: null });
  });

  it('on a reset, replaces the password, re-enables the admin and ends their sessions only', async () => {
    const email = `reset-${randomUUID()}@example.com`;
    const admin = await prisma.adminUser.create({
      data: { email, name: 'Old', passwordHash: 'old', disabledAt: new Date() },
    });
    const other = await prisma.adminUser.create({
      data: { email: `other-${randomUUID()}@example.com`, name: 'Other', passwordHash: 'x' },
    });
    made.push(admin.id, other.id);
    const stolen = await createAdminSession(prisma, admin.id, '127.0.0.1');
    const unrelated = await createAdminSession(prisma, other.id, '127.0.0.1');

    expect(await createOrResetAdmin(prisma, { email, name: 'Renamed', passwordHash: 'new' })).toBe('reset');

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({ name: 'Renamed', passwordHash: 'new', disabledAt: null });
    expect(await validateAdminSession(prisma, stolen)).toBeNull();
    expect(await prisma.adminSession.count({ where: { adminUserId: admin.id } })).toBe(0);
    expect(await validateAdminSession(prisma, unrelated)).not.toBeNull();
  });
});

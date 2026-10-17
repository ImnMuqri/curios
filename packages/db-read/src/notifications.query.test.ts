import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getNotifications } from './notifications.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

async function anOwner(page: boolean, notifyLeads?: boolean) {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `notify-${randomUUID()}@example.com`,
      ...(page ? { pages: { create: { handle: `nt-${slug}`, skeleton: `nt-${slug}`, displayName: 'N', ...(notifyLeads === undefined ? {} : { notifyLeads }) } } } : {}),
    },
    select: { id: true },
  });
  return account.id;
}

describe('getNotifications', () => {
  it('has the lead email on by default', async () => {
    expect(await getNotifications(await anOwner(true))).toEqual({ leads: true });
  });

  it('reads it off once switched off', async () => {
    expect(await getNotifications(await anOwner(true, false))).toEqual({ leads: false });
  });

  it('is null for an owner with no page yet', async () => {
    expect(await getNotifications(await anOwner(false))).toBeNull();
  });
});

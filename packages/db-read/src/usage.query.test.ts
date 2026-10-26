import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FREE_CONVERSATIONS_PER_MONTH } from '@curios/core';
import { countLeadsThisMonth, countOrdersThisMonth, getConversationUsage } from './usage.query.js';
import { clearSettingsCache } from './settings.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-17T04:00:00.000Z');
let pageId = '';

/** A limit as the admin's route stores it, then the cache forgotten; `undo` takes it away again. */
async function withSetting(key: string, value: number, run: () => Promise<void>) {
  await write.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  clearSettingsCache();
  try {
    await run();
  } finally {
    await write.systemSetting.deleteMany({ where: { key } });
    clearSettingsCache();
  }
}

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'usage@example.com',
      pages: { create: { handle: 'usage', skeleton: 'usage', displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';

  await write.usageCounter.createMany({
    data: [
      { pageId, period: '2026-09', count: 12 },
      // Last month's, which must not be counted into this month's.
      { pageId, period: '2026-08', count: 99 },
    ],
  });
});

describe('getConversationUsage', () => {
  it('counts this month, in the same period the API increments', async () => {
    // The API's counter keys on `now.toISOString().slice(0, 7)`, so this must
    // agree with it exactly: a different bucket would show an owner a number
    // nothing is enforcing.
    expect(await getConversationUsage(pageId, NOW)).toEqual({
      used: 12,
      cap: FREE_CONVERSATIONS_PER_MONTH,
      period: '2026-09',
    });
  });

  it('reads the cap the admin set, not the default', async () => {
    await withSetting('cap', 10, async () => {
      expect((await getConversationUsage(pageId, NOW)).cap).toBe(10);
    });
  });

  it('reads zero for a month with no conversations at all', async () => {
    const usage = await getConversationUsage(pageId, new Date('2026-11-02T00:00:00.000Z'));

    expect(usage).toEqual({ used: 0, cap: FREE_CONVERSATIONS_PER_MONTH, period: '2026-11' });
  });

  it('counts nothing for another page', async () => {
    const other = await write.account.create({
      data: {
        email: 'usage-other@example.com',
        pages: { create: { handle: 'usage-other', skeleton: 'usageother', displayName: 'Someone Else' } },
      },
      select: { pages: { select: { id: true } } },
    });

    expect((await getConversationUsage(other.pages[0]?.id ?? '', NOW)).used).toBe(0);
  });
});

describe('countLeadsThisMonth', () => {
  it('counts the leads captured this month, by the same UTC month as the conversations', async () => {
    const at = (iso: string) => new Date(iso);
    let n = 0;
    const lead = async (createdAt: Date, page = pageId) => {
      n += 1;
      const conversation = await write.conversation.create({ data: { pageId: page }, select: { id: true } });
      await write.lead.create({ data: { pageId: page, conversationId: conversation.id, phone: `+6012345${String(n).padStart(4, '0')}`, createdAt } });
    };
    await lead(at('2026-09-01T00:00:00.000Z'));
    await lead(at('2026-09-16T23:00:00.000Z'));
    // Last month, and after now: neither is this month's so far.
    await lead(at('2026-08-31T23:59:59.000Z'));
    await lead(at('2026-09-20T00:00:00.000Z'));

    expect(await countLeadsThisMonth(pageId, NOW)).toBe(2);
  });

  it('counts nothing for another page', async () => {
    const other = await write.account.create({
      data: {
        email: 'usage-leads-other@example.com',
        pages: { create: { handle: 'usage-leads-other', skeleton: 'usageleadsother', displayName: 'Someone Else' } },
      },
      select: { pages: { select: { id: true } } },
    });

    expect(await countLeadsThisMonth(other.pages[0]?.id ?? '', NOW)).toBe(0);
  });
});

describe('countOrdersThisMonth', () => {
  let n = 0;
  const order = async (createdAt: Date, page = pageId) => {
    n += 1;
    await write.order.create({
      data: {
        pageId: page,
        number: n,
        code: `U${n}`,
        tokenHash: `usage-order-${n}`,
        customerName: 'Aina',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-09-20T00:00:00Z'),
        itemsCents: 1000,
        deliveryCents: 0,
        totalCents: 1000,
        createdAt,
      },
    });
  };

  it('counts the orders placed this month, by the same UTC month as the meters beside it', async () => {
    await order(new Date('2026-09-01T00:00:00.000Z'));
    await order(new Date('2026-09-16T23:00:00.000Z'));
    // Last month, and after now: neither is this month's so far.
    await order(new Date('2026-08-31T23:59:59.000Z'));
    await order(new Date('2026-09-20T00:00:00.000Z'));

    expect(await countOrdersThisMonth(pageId, NOW)).toBe(2);
  });

  it('counts nothing for another page', async () => {
    const other = await write.account.create({
      data: {
        email: 'usage-orders-other@example.com',
        pages: { create: { handle: 'usage-orders-other', skeleton: 'usageordersother', displayName: 'Someone Else' } },
      },
      select: { pages: { select: { id: true } } },
    });

    expect(await countOrdersThisMonth(other.pages[0]?.id ?? '', NOW)).toBe(0);
  });
});

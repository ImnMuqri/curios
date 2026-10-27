import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPayments } from './payments.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Wednesday 2026-10-21, 10:00 in Malaysia. Malaysia midnight today is 2026-10-20T16:00Z.
const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIDNIGHT = new Date('2026-10-20T16:00:00.000Z');
const DAY = 86_400_000;
const NEXT_MONTH = new Date(NOW.getTime() + 25 * DAY);
const ids: Record<string, string> = {};

async function aPage(key: string, page: Record<string, unknown> = {}): Promise<string> {
  const handle = `py-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: key, mode: 'BUSINESS', published: true, ...page } } },
    select: { pages: { select: { id: true } } },
  });
  ids[key] = account.pages[0]!.id;
  return ids[key];
}

const pay = (pageId: string | null, data: Record<string, unknown>) =>
  write.payment.create({ data: { pageId, plan: 'MONTHLY', amountCents: 2900, status: 'PAID', provider: 'CHIP', ...data } as never });

const hook = (purchaseId: string, outcome: string | null, ago: number, extra: Record<string, unknown> = {}) => ({
  source: 'webhook', eventType: 'purchase.paid', purchaseId, body: 'SECRET-BODY', outcome, lastAttemptAt: new Date(NOW.getTime() - ago), ...extra,
});

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await write.$executeRawUnsafe('TRUNCATE "ChipWebhookEvent"');

  const soon = new Date(NOW.getTime() + 3 * DAY);
  await aPage('Monthly', { paidUntil: NEXT_MONTH });
  await pay(ids.Monthly!, { createdAt: NOW, paidAt: new Date(MIDNIGHT.getTime() + 3_600_000), grantedUntil: NEXT_MONTH, providerRef: 'pur_m', paidVia: 'FPX' });
  await aPage('Annual', { paidUntil: soon });
  await pay(ids.Annual!, { plan: 'ANNUAL', amountCents: 29000, createdAt: new Date(NOW.getTime() - 3 * DAY), paidAt: new Date(NOW.getTime() - 3 * DAY), grantedUntil: soon, providerRef: 'pur_a', paidVia: 'Card · Visa' });
  await aPage('Gifted', { paidUntil: NEXT_MONTH });
  await pay(ids.Gifted!, { provider: 'GRANT', amountCents: 0, paidAt: NOW, grantedUntil: NEXT_MONTH });
  await aPage('Lapsed', { paidUntil: new Date(NOW.getTime() - DAY) });
  await pay(ids.Lapsed!, { createdAt: new Date(NOW.getTime() - 31 * DAY), paidAt: new Date(NOW.getTime() - 31 * DAY), grantedUntil: new Date(NOW.getTime() - DAY), providerRef: 'pur_l' });
  // Unpaid ones, and one whose page is gone.
  await pay(ids.Lapsed!, { status: 'PENDING', paidAt: null, grantedUntil: null, providerRef: 'pur_p', createdAt: new Date(NOW.getTime() - 1000) });
  await pay(ids.Lapsed!, { status: 'EXPIRED', paidAt: null, grantedUntil: null, providerRef: 'pur_e', createdAt: new Date(NOW.getTime() - 2000) });
  await pay(ids.Lapsed!, { status: 'FAILED', paidAt: null, grantedUntil: null, providerRef: null, createdAt: new Date(NOW.getTime() - 3000) });
  await pay(null, { pageHandle: 'gone-page', paidAt: new Date(NOW.getTime() - 8 * DAY), grantedUntil: new Date(NOW.getTime() - DAY), providerRef: 'pur_g', createdAt: new Date(NOW.getTime() - 4000) });

  await write.chipWebhookEvent.createMany({
    data: [
      hook('pur_m', 'failed', 3_600_000, { attempts: 3, statusCode: 500, error: 'Error' }),
      hook('pur_a', 'ok', 7_200_000, { statusCode: 200 }),
      hook('pur_unknown', 'failed', 10_000),
      hook('pur_old', 'failed', 25 * 3_600_000),
      hook('pur_wait', null, 5_000, { eventType: 'purchase.created' }),
    ],
  });

  // Shop orders: CHIP this Malaysia month, CHIP last month, receipt this month.
  const shop = async (key: string, orders: Record<string, unknown>[]) => {
    await aPage(key);
    for (const [i, o] of orders.entries()) {
      await write.order.create({
        data: {
          pageId: ids[key]!, number: i + 1, code: `${key}${i}`, tokenHash: randomUUID(), customerName: 'x', phone: '1',
          itemsCents: 1000, deliveryCents: 0, totalCents: 1000, status: 'PAID', ...o,
        } as never,
      });
    }
  };
  await shop('ShopA', [
    { paidVia: 'CHIP', paidAt: new Date('2026-09-30T16:00:00Z'), totalCents: 1500 }, // 1 Oct 00:00 in Malaysia: in
    { paidVia: 'CHIP', paidAt: new Date('2026-09-30T15:59:59Z'), totalCents: 7000 }, // 30 Sep: out
    { paidVia: 'RECEIPT', paidAt: NOW, totalCents: 8000 },
  ]);
  await shop('ShopB', [{ paidVia: 'CHIP', paidAt: NOW, totalCents: 2500 }]);
});

afterAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "ChipWebhookEvent"');
  await write.$disconnect();
});

describe('getPayments', () => {
  it('counts revenue in the period and never a GRANT', async () => {
    expect((await getPayments('today', NOW)).receivedCents).toBe(2900);
    expect((await getPayments('7d', NOW)).receivedCents).toBe(2900 + 29000);
  });

  it('counts paying pages by plan and the plans ending this week', async () => {
    const p = await getPayments('7d', NOW);
    expect(p.paying).toEqual({ total: 2, monthly: 1, annual: 1 }); // not Gifted, not Lapsed
    expect(p.endingThisWeek).toBe(1); // Annual
  });

  it('lists CHIP payments newest first, with their status and no grants', async () => {
    const { rows } = await getPayments('7d', NOW);
    expect(rows.some((r) => r.amountCents === 0)).toBe(false);
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.status).slice(0, 5)).toEqual(['Paid', 'Not confirmed', 'Abandoned', 'Failed', 'Paid']);
    expect(rows[0]).toMatchObject({ name: 'Monthly', plan: 'MONTHLY', paidVia: 'FPX', amountCents: 2900, providerRef: 'pur_m' });
    expect(rows.find((r) => r.providerRef === 'pur_g')!.name).toBe('gone-page');
    expect(rows.find((r) => r.providerRef === 'pur_l')!.paidVia).toBeNull();
  });

  it('lists only the last 24 hours of webhooks, newest first, with the page name', async () => {
    const p = await getPayments('7d', NOW);
    expect(p.webhooks.map((w) => w.purchaseId)).toEqual(['pur_wait', 'pur_unknown', 'pur_m', 'pur_a']);
    expect(p.webhooks[2]).toMatchObject({ attempts: 3, outcome: 'failed', statusCode: 500, displayName: 'Monthly', eventType: 'purchase.paid' });
    expect(p.webhooks[0]).toMatchObject({ outcome: null, displayName: null });
    expect(JSON.stringify(p.webhooks)).not.toContain('SECRET-BODY');
    expect(p.failedWebhooks24h).toBe(2);
  });

  it('totals only CHIP-paid shop orders from this Malaysia month', async () => {
    expect((await getPayments('7d', NOW)).shop).toEqual({ orders: 2, totalCents: 4000, shops: 2 });
  });
});

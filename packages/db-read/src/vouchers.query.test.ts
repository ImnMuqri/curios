import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getCheckout } from './orders.query.js';
import { getPublicPage } from './page.query.js';
import { getOwnerVouchers } from './vouchers.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-10-18T15:30:00Z');
const accountIds: string[] = [];
let counter = 0;

async function anOwner() {
  const handle = `vo-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: {
      email: `vo-${randomUUID()}@example.com`,
      pages: { create: { handle, skeleton: handle, displayName: 'Dapur Kak Nor', mode: 'BUSINESS', storeEnabled: true, published: true } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  accountIds.push(account.id);
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '', handle };
}

async function aVoucher(pageId: string, extra: Record<string, unknown> = {}) {
  counter += 1;
  return write.shopVoucher.create({ data: { pageId, mode: 'AUTO', name: `Deal ${counter}`, kind: 'PERCENT', percent: 10, ...extra } });
}

async function anOrderWith(pageId: string, voucherId: string, extra: Record<string, unknown> = {}) {
  counter += 1;
  await write.order.create({
    data: {
      pageId,
      number: counter,
      code: `V${counter}`,
      tokenHash: hashSessionValue(randomUUID()),
      customerName: 'Aina',
      phone: '+60123456789',
      itemsCents: 5000,
      deliveryCents: 0,
      totalCents: 4500,
      discountCents: 500,
      voucherId,
      voucherLabel: 'Deal',
      ...extra,
    },
  });
}

afterAll(async () => {
  await write.account.deleteMany({ where: { id: { in: accountIds } } });
  await write.$disconnect();
});

describe('getOwnerVouchers', () => {
  it('counts a placed and a paid order as uses, but not one cancelled before it was paid', async () => {
    const owner = await anOwner();
    const v = await aVoucher(owner.pageId, { maxUses: 10 });
    await anOrderWith(owner.pageId, v.id, { status: 'PLACED' });
    await anOrderWith(owner.pageId, v.id, { status: 'PAID', paidAt: NOW });
    await anOrderWith(owner.pageId, v.id, { status: 'CANCELLED', cancelledAt: NOW });
    // Cancelled after paying still happened.
    await anOrderWith(owner.pageId, v.id, { status: 'CANCELLED', cancelledAt: NOW, paidAt: NOW });
    const [got] = await getOwnerVouchers(owner.accountId, NOW);
    expect(got).toMatchObject({ id: v.id, uses: 3, state: 'on', label: v.name, name: v.name, code: null, itemName: null, endsAt: null });
  });

  it('says off, ended or usedUp, in that order of precedence, and names the item', async () => {
    const owner = await anOwner();
    const item = await write.item.create({ data: { pageId: owner.pageId, name: 'Kek', slug: 'kek', position: 0 } });
    const off = await aVoucher(owner.pageId, { active: false, endsAt: new Date('2026-10-01T00:00:00Z') });
    const ended = await aVoucher(owner.pageId, { endsAt: NOW });
    const spent = await aVoucher(owner.pageId, { mode: 'CODE', code: 'RAYA', name: null, kind: 'AMOUNT', percent: null, amountCents: 300, maxUses: 1, itemId: item.id, endsAt: new Date('2026-11-01T00:00:00Z') });
    await anOrderWith(owner.pageId, spent.id);
    const byId = new Map((await getOwnerVouchers(owner.accountId, NOW)).map((v) => [v.id, v]));
    expect(byId.get(off.id)?.state).toBe('off');
    expect(byId.get(ended.id)?.state).toBe('ended');
    expect(byId.get(spent.id)).toMatchObject({ state: 'usedUp', uses: 1, label: 'RAYA', code: 'RAYA', itemName: 'Kek', endsAt: '2026-11-01T00:00:00.000Z' });
  });

  it("does not show another owner's vouchers", async () => {
    const a = await anOwner();
    const b = await anOwner();
    await aVoucher(b.pageId);
    expect(await getOwnerVouchers(a.accountId, NOW)).toEqual([]);
  });
});

describe('getCheckout vouchers', () => {
  it('lists a live automatic voucher, and leaves out codes, switched-off, ended and used-up ones', async () => {
    const owner = await anOwner();
    const live = await aVoucher(owner.pageId, { maxUses: 5, endsAt: new Date('2026-11-01T00:00:00Z') });
    await aVoucher(owner.pageId, { mode: 'CODE', code: 'SECRET', name: null });
    await aVoucher(owner.pageId, { active: false });
    await aVoucher(owner.pageId, { endsAt: NOW });
    const spent = await aVoucher(owner.pageId, { maxUses: 1 });
    await anOrderWith(owner.pageId, spent.id);
    const checkout = await getCheckout(owner.handle, NOW);
    expect(checkout?.vouchers).toEqual([
      { id: live.id, mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: live.name },
    ]);
  });

  it('frees a use when the order is cancelled before it was paid', async () => {
    const owner = await anOwner();
    const v = await aVoucher(owner.pageId, { maxUses: 1 });
    await anOrderWith(owner.pageId, v.id, { status: 'CANCELLED', cancelledAt: NOW });
    expect((await getCheckout(owner.handle, NOW))?.vouchers.map((x) => x.id)).toEqual([v.id]);
  });
});

describe('getPublicPage shopOrdering vouchers', () => {
  it('carries the live automatic vouchers the Links tab basket takes off, and none while the shop is paused', async () => {
    const owner = await anOwner();
    const live = await aVoucher(owner.pageId, { endsAt: new Date('2099-01-01T00:00:00Z') });
    await aVoucher(owner.pageId, { mode: 'CODE', code: 'SECRET', name: null });
    await aVoucher(owner.pageId, { active: false });
    const spent = await aVoucher(owner.pageId, { maxUses: 1 });
    await anOrderWith(owner.pageId, spent.id);
    const page = await getPublicPage(owner.handle);
    expect(page?.shopOrdering?.vouchers).toEqual([
      { id: live.id, mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: live.name },
    ]);
    // A spent trial and no plan: orders are paused, and a paused shop honours no voucher.
    await write.page.update({ where: { id: owner.pageId }, data: { ordersPlaced: 100000 } });
    const paused = await getPublicPage(owner.handle);
    expect(paused?.shopOrdering).toMatchObject({ canTakeOrders: false, vouchers: [] });
  });
});

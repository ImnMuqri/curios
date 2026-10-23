import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getCheckout, getOrderByToken, getShopItem, getOrderStats, getOwnerOrders } from './orders.query.js';
import { countNavBadges } from './my-curios.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Sunday 2026-10-18, 23:30 in Malaysia (15:30Z).
const NOW = new Date('2026-10-18T15:30:00Z');

interface Owner {
  accountId: string;
  pageId: string;
  handle: string;
}

const accountIds: string[] = [];
let mine: Owner;
let theirs: Owner;
let counter = 0;

async function anOwner(extra: Record<string, unknown> = {}): Promise<Owner> {
  const slug = randomUUID().slice(0, 8);
  const handle = `od-${slug}`;
  const account = await write.account.create({
    data: {
      email: `od-${randomUUID()}@example.com`,
      pages: { create: { handle, skeleton: handle, displayName: 'Dapur Kak Nor', mode: 'BUSINESS', storeEnabled: true, published: true, ...extra } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  accountIds.push(account.id);
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '', handle };
}

async function anOrder(pageId: string, extra: Record<string, unknown> = {}, token = randomUUID()): Promise<string> {
  counter += 1;
  const order = await write.order.create({
    data: {
      pageId,
      number: counter,
      code: `C${counter}`,
      tokenHash: hashSessionValue(token),
      customerName: 'Aina',
      phone: '+60123456789',
      method: 'PICKUP',
      day: new Date('2026-10-20T00:00:00Z'),
      itemsCents: 5000,
      deliveryCents: 0,
      totalCents: 5000,
      lines: { create: [{ itemName: 'Kek', optionLabel: '1kg', unitPriceCents: 5000, quantity: 1, position: 0 }] },
      ...extra,
    },
    select: { id: true },
  });
  return order.id;
}

beforeAll(async () => {
  mine = await anOwner();
  theirs = await anOwner();
});

afterAll(async () => {
  // Orders and lines go with their page, pages with their account.
  await write.account.deleteMany({ where: { id: { in: accountIds } } });
  await write.$disconnect();
});

describe('getOwnerOrders', () => {
  it('is newest first, scoped to the owner, with lines and the day as text', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    await anOrder(owner.pageId, { customerName: 'Old', createdAt: new Date('2026-10-01T00:00:00Z') });
    await anOrder(owner.pageId, { customerName: 'New', createdAt: new Date('2026-10-10T00:00:00Z') });
    await anOrder(other.pageId, { customerName: 'Theirs' });
    const orders = await getOwnerOrders(owner.accountId);
    expect(orders.map((o) => o.customerName)).toEqual(['New', 'Old']);
    expect(orders[0]?.day).toBe('2026-10-20');
    expect(orders[0]?.lines[0]).toMatchObject({ itemName: 'Kek', optionLabel: '1kg', unitPriceCents: 5000, quantity: 1, photoKey: null });
  });

  it('says when CHIP took a second payment for an order paid another way', async () => {
    const owner = await anOwner();
    await anOrder(owner.pageId, { customerName: 'Twice', status: 'PAID', paidAt: NOW, paidVia: 'RECEIPT', chipPurchaseId: `p-${randomUUID()}`, chipPaidTwiceAt: NOW });
    const [order] = await getOwnerOrders(owner.accountId);
    expect(order).toMatchObject({ paidVia: 'RECEIPT', chipPaidTwiceAt: NOW });
  });

  it('keeps a completed order with a second payment owed back among the ones that need the owner', async () => {
    const owner = await anOwner();
    await anOrder(owner.pageId, { customerName: 'DoneTwice', status: 'COMPLETED', paidAt: NOW, paidVia: 'RECEIPT', chipPurchaseId: `p-${randomUUID()}`, chipPaidTwiceAt: NOW });
    await anOrder(owner.pageId, { customerName: 'Fine', status: 'COMPLETED', paidAt: NOW });
    const orders = await getOwnerOrders(owner.accountId, { limit: 1 });
    expect(orders.map((o) => o.customerName).sort()).toEqual(['DoneTwice', 'Fine']);
    const trimmed = await getOwnerOrders(owner.accountId, { limit: 0 });
    expect(trimmed.map((o) => o.customerName)).toEqual(['DoneTwice']);
  });

  it('says how an order was paid, for Orders to tell an online payment from a hand-marked one', async () => {
    const owner = await anOwner();
    await anOrder(owner.pageId, { customerName: 'Online', status: 'PAID', paidAt: NOW, paidVia: 'CHIP', chipPurchaseId: `p-${randomUUID()}`, paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CH0042' });
    await anOrder(owner.pageId, { customerName: 'Hand' });
    const orders = await getOwnerOrders(owner.accountId);
    expect(orders.find((o) => o.customerName === 'Online')).toMatchObject({ paidVia: 'CHIP', paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CH0042' });
    expect(orders.find((o) => o.customerName === 'Hand')).toMatchObject({ paidVia: null, paidMethodLabel: null, paidRef: null, chipPaidTwiceAt: null });
    // The purchase id and the payer's email stay on the server.
    expect(orders[0]).not.toHaveProperty('chipPurchaseId');
    expect(orders[0]).not.toHaveProperty('payerEmail');
  });

  it('gives a line its item photo while the item exists', async () => {
    const owner = await anOwner();
    const item = await write.item.create({ data: { pageId: owner.pageId, name: 'Kek', slug: 'kek', photoKey: 'items/kek.jpg', position: 0 } });
    const id = await anOrder(owner.pageId);
    await write.orderLine.updateMany({ where: { orderId: id }, data: { itemId: item.id } });
    const [order] = await getOwnerOrders(owner.accountId);
    expect(order?.lines[0]?.photoKey).toBe('items/kek.jpg');
  });

  it('keeps every order that still needs the owner, however old, beside the newest 100 of the rest', async () => {
    const owner = await anOwner();
    const old = (day: number) => new Date(`2026-01-0${day}T00:00:00Z`);
    const toCheck = await anOrder(owner.pageId, { customerName: 'To check', receiptKey: 'receipts/x/r.jpg', receiptUploadedAt: old(1), createdAt: old(1) });
    const toMake = await anOrder(owner.pageId, { customerName: 'To make', status: 'PAID', paidAt: old(2), createdAt: old(2) });
    const owed = await anOrder(owner.pageId, { customerName: 'Owed', status: 'CANCELLED', paidAt: old(3), cancelledAt: old(3), createdAt: old(3) });
    const refunded = await anOrder(owner.pageId, { customerName: 'Refunded', status: 'CANCELLED', paidAt: old(4), cancelledAt: old(4), refundedAt: old(4), createdAt: old(4) });
    await write.order.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        pageId: owner.pageId,
        number: 10_000 + i,
        code: `D${i}`,
        tokenHash: hashSessionValue(randomUUID()),
        customerName: 'Done',
        phone: '+60123456789',
        method: 'PICKUP' as const,
        day: new Date('2026-10-20T00:00:00Z'),
        itemsCents: 1,
        deliveryCents: 0,
        totalCents: 1,
        status: 'COMPLETED' as const,
        createdAt: new Date(Date.UTC(2026, 5, 1) + i * 60_000),
      })),
    });

    // As the Orders screen asks.
    const orders = await getOwnerOrders(owner.accountId, { limit: 100 });
    const ids = orders.map((o) => o.id);

    // 100 of the 101 done ones (the oldest drops), and the three that need the owner.
    expect(orders).toHaveLength(103);
    expect(ids).toEqual(expect.arrayContaining([toCheck, toMake, owed]));
    expect(ids).not.toContain(refunded);
    expect(new Set(ids).size).toBe(ids.length);
    // Still newest first, the old actionable ones at the end.
    expect(orders.slice(-3).map((o) => o.customerName)).toEqual(['Owed', 'To make', 'To check']);
    const times = orders.map((o) => o.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('keeps the receipt key and caps the finished ones at 100', async () => {
    const owner = await anOwner();
    await write.order.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        status: 'COMPLETED' as const,
        pageId: owner.pageId,
        number: i + 1,
        code: `K${i}`,
        tokenHash: hashSessionValue(randomUUID()),
        customerName: 'A',
        phone: '+60123456789',
        method: 'PICKUP' as const,
        day: new Date('2026-10-20T00:00:00Z'),
        itemsCents: 1,
        deliveryCents: 0,
        totalCents: 1,
        receiptKey: i === 0 ? 'receipts/x/a.png' : null,
      })),
    });
    expect(await getOwnerOrders(owner.accountId, { limit: 500 })).toHaveLength(100);
    expect(await getOwnerOrders(owner.accountId, { limit: 5 })).toHaveLength(5);
  });
});

describe('getOrderStats', () => {
  it('counts to-check (PLACED with a receipt), to-make (PAID) and paid sen per Malaysian day', async () => {
    const owner = await anOwner();
    const p = owner.pageId;
    await anOrder(p, { receiptKey: 'r/a.png', receiptType: 'image/png', receiptUploadedAt: NOW });
    await anOrder(p); // PLACED, no receipt: not to check
    // 2026-10-18 23:00 MYT = 15:00Z, today.
    await anOrder(p, { status: 'PAID', totalCents: 1000, paidAt: new Date('2026-10-18T15:00:00Z') });
    // 2026-10-17 00:30 MYT = 16 Oct 16:30Z: yesterday in Malaysia, the 16th in UTC.
    await anOrder(p, { status: 'COMPLETED', totalCents: 2000, paidAt: new Date('2026-10-16T16:30:00Z') });
    // Seven days back, i.e. 2026-10-11: outside the window (it covers 12th to 18th).
    await anOrder(p, { status: 'PAID', totalCents: 4000, paidAt: new Date('2026-10-11T04:00:00Z') });
    // Cancelled after being paid: left out.
    await anOrder(p, { status: 'CANCELLED', totalCents: 8000, paidAt: new Date('2026-10-18T03:00:00Z'), cancelledAt: NOW });
    await anOrder(theirs.pageId, { status: 'PAID', totalCents: 16000, paidAt: new Date('2026-10-18T03:00:00Z') });

    const stats = await getOrderStats(owner.accountId, NOW);
    expect(stats.toCheck).toBe(1);
    expect(stats.toMake).toBe(2);
    expect(stats.paidThisWeekCents).toBe(3000);
  });
});

describe('getOrderByToken', () => {
  it('is null for an unknown token', async () => {
    expect(await getOrderByToken('nope-' + randomUUID())).toBeNull();
  });

  it('still returns the order of a suspended page: its customer can read it, and only paying and uploading are refused', async () => {
    const owner = await anOwner({ suspendedAt: new Date(), suspendReason: 'x', bankName: 'Maybank', bankAccountName: 'Nor', bankAccountNumber: '1122334455', paymentQrKey: 'qr/a.png' });
    const token = randomUUID();
    await anOrder(owner.pageId, { customerName: 'Aina' }, token);

    expect(await getOrderByToken(token)).toMatchObject({
      customerName: 'Aina',
      page: { handle: owner.handle, suspended: true, paymentQrKey: null, bankName: null, bankAccountNumber: null, chipMethods: null },
    });
    expect(await getCheckout(owner.handle, NOW)).toBeNull();
  });

  it('returns the order with its page, payment details and links', async () => {
    const owner = await anOwner({ bankName: 'Maybank', bankAccountName: 'Nor', bankAccountNumber: '1122334455', paymentQrKey: 'qr/a.png' });
    await write.link.create({ data: { pageId: owner.pageId, label: 'WhatsApp', url: 'https://wa.me/60123456789', position: 0 } });
    const token = randomUUID();
    await anOrder(owner.pageId, { customerName: 'Aina' }, token);
    const order = await getOrderByToken(token);
    expect(order).toMatchObject({
      customerName: 'Aina',
      day: '2026-10-20',
      status: 'PLACED',
      receiptKey: null,
      page: {
        handle: owner.handle,
        displayName: 'Dapur Kak Nor',
        bankName: 'Maybank',
        bankAccountName: 'Nor',
        bankAccountNumber: '1122334455',
        paymentQrKey: 'qr/a.png',
        links: [{ label: 'WhatsApp', url: 'https://wa.me/60123456789' }],
      },
    });
    expect(order?.page).toHaveProperty('accentColor');
    expect(order?.lines).toHaveLength(1);
  });

  it('says how an order was paid online, and only whether a CHIP payment is under way', async () => {
    const owner = await anOwner();
    const paidToken = randomUUID();
    await anOrder(owner.pageId, { status: 'PAID', paidAt: NOW, paidVia: 'CHIP', chipPurchaseId: `p-${randomUUID()}`, payerEmail: 'a@example.com', paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CH0042' }, paidToken);
    const paid = await getOrderByToken(paidToken);
    expect(paid).toMatchObject({ paidVia: 'CHIP', paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CH0042', chipPending: false });
    // The purchase id and the payer's email stay on the server.
    expect(paid).not.toHaveProperty('chipPurchaseId');
    expect(paid).not.toHaveProperty('payerEmail');

    const pendingToken = randomUUID();
    await anOrder(owner.pageId, { chipPurchaseId: `p-${randomUUID()}` }, pendingToken);
    expect(await getOrderByToken(pendingToken)).toMatchObject({ status: 'PLACED', chipPending: true, paidVia: null });
  });

  it('says what the shop takes online, for trying to pay again, and nothing once its key was refused', async () => {
    const owner = await anOwner();
    const token = randomUUID();
    await anOrder(owner.pageId, {}, token);
    expect((await getOrderByToken(token))?.page.chipMethods).toBeNull();

    const account = { brandId: randomUUID(), secretKeyCiphertext: 'sealed', publicKeyPem: 'pem', methods: ['fpx', 'visa'], checkedAt: NOW };
    await write.shopPaymentAccount.create({ data: { pageId: owner.pageId, ...account } });
    const order = await getOrderByToken(token);
    expect(order?.page.chipMethods).toEqual(['fpx', 'visa']);
    // Never the sealed key, nor anything else of the account.
    expect(JSON.stringify(order)).not.toContain('sealed');

    await write.shopPaymentAccount.update({ where: { pageId: owner.pageId }, data: { lastErrorAt: NOW } });
    expect((await getOrderByToken(token))?.page.chipMethods).toBeNull();
  });

  it('does not match on the hash itself', async () => {
    const token = randomUUID();
    await anOrder(mine.pageId, {}, token);
    expect(await getOrderByToken(hashSessionValue(token))).toBeNull();
  });
});

describe('getCheckout', () => {
  it('is null for an unknown handle, a personal page and a closed store', async () => {
    const personal = await anOwner({ mode: 'PERSONAL' });
    const closed = await anOwner({ storeEnabled: false });
    expect(await getCheckout('no-such-' + randomUUID())).toBeNull();
    expect(await getCheckout(personal.handle)).toBeNull();
    expect(await getCheckout(closed.handle)).toBeNull();
  });

  it('carries the shop and checkout settings, with canTakeOrders decided by the core', async () => {
    const owner = await anOwner({ pickupEnabled: true, deliveryMode: 'FLAT', deliveryFeeCents: 800, minNoticeDays: 2, closedDays: [0], deliveryNote: 'KL only' });
    const checkout = await getCheckout(owner.handle, NOW);
    expect(checkout).toMatchObject({ handle: owner.handle, pickupEnabled: true, deliveryMode: 'FLAT', deliveryFeeCents: 800, minNoticeDays: 2, closedDays: [0], deliveryNote: 'KL only', canTakeOrders: true, items: [] });

    const spent = await anOwner({ ordersPlaced: 3 });
    expect((await getCheckout(spent.handle, NOW))?.canTakeOrders).toBe(false);
    const paid = await anOwner({ ordersPlaced: 3, paidUntil: new Date('2026-12-01T00:00:00Z') });
    expect((await getCheckout(paid.handle, NOW))?.canTakeOrders).toBe(true);
  });

  it('says whether the shop takes a QR or bank transfer, and which methods its CHIP account listed', async () => {
    const plain = await anOwner();
    expect(await getCheckout(plain.handle, NOW)).toMatchObject({ payByQr: false, hasQr: false, chipMethods: null });

    const qr = await anOwner({ paymentQrKey: 'qr/a.png' });
    expect(await getCheckout(qr.handle, NOW)).toMatchObject({ payByQr: true, hasQr: true });
    const bank = await anOwner({ bankName: 'Maybank', bankAccountName: 'Nor', bankAccountNumber: '1122' });
    expect(await getCheckout(bank.handle, NOW)).toMatchObject({ payByQr: true, hasQr: false });
    const halfBank = await anOwner({ bankName: 'Maybank', bankAccountName: '', bankAccountNumber: '1122' });
    expect((await getCheckout(halfBank.handle, NOW))?.payByQr).toBe(false);

    const chip = await anOwner();
    const account = { brandId: randomUUID(), secretKeyCiphertext: 'sealed', publicKeyPem: 'pem', methods: ['fpx', 'visa'], checkedAt: NOW };
    await write.shopPaymentAccount.create({ data: { pageId: chip.pageId, ...account } });
    expect((await getCheckout(chip.handle, NOW))?.chipMethods).toEqual(['fpx', 'visa']);

    // A key CHIP refused takes nothing online until the owner connects again.
    const refused = await anOwner();
    await write.shopPaymentAccount.create({ data: { pageId: refused.pageId, ...account, lastErrorAt: NOW } });
    expect((await getCheckout(refused.handle, NOW))?.chipMethods).toBeNull();
  });
});

describe('getShopItem', () => {
  async function anItem(pageId: string, name: string, slug: string, extra: Record<string, unknown> = {}) {
    return write.item.create({ data: { pageId, name, slug, position: 0, priceCents: 2500, ...extra }, select: { id: true } });
  }

  it('finds an available item by its slug, with the shop it belongs to', async () => {
    const owner = await anOwner({ shopHalal: true, minNoticeDays: 2 });
    await anItem(owner.pageId, 'Kek Batik', 'kek-batik');
    const found = await getShopItem(owner.handle, 'kek-batik', NOW);
    expect(found?.item).toMatchObject({ name: 'Kek Batik', slug: 'kek-batik', priceCents: 2500 });
    expect(found?.shop).toMatchObject({ handle: owner.handle, shopHalal: true, minNoticeDays: 2, canTakeOrders: true });
    expect(found?.shop.items.map((i) => i.slug)).toEqual(['kek-batik']);
  });

  it('is null for an unknown slug, another shop’s slug, an unavailable item, a personal page and a closed shop', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    await anItem(owner.pageId, 'Off', 'off', { available: false });
    await anItem(other.pageId, 'Theirs', 'theirs');
    expect(await getShopItem(owner.handle, 'nope', NOW)).toBeNull();
    expect(await getShopItem(owner.handle, 'theirs', NOW)).toBeNull();
    expect(await getShopItem(owner.handle, 'off', NOW)).toBeNull();
    const personal = await anOwner({ mode: 'PERSONAL' });
    await anItem(personal.pageId, 'P', 'p');
    expect(await getShopItem(personal.handle, 'p', NOW)).toBeNull();
    const closed = await anOwner({ storeEnabled: false });
    await anItem(closed.pageId, 'C', 'c');
    expect(await getShopItem(closed.handle, 'c', NOW)).toBeNull();
  });
});

describe('countNavBadges orders', () => {
  it('counts PLACED orders with a receipt, for this owner only', async () => {
    const owner = await anOwner();
    await anOrder(owner.pageId, { receiptKey: 'r/a.png', receiptUploadedAt: NOW });
    await anOrder(owner.pageId);
    await anOrder(owner.pageId, { status: 'PAID', receiptKey: 'r/b.png', receiptUploadedAt: NOW, paidAt: NOW });
    await anOrder(theirs.pageId, { receiptKey: 'r/c.png', receiptUploadedAt: NOW });
    expect((await countNavBadges(owner.accountId)).orders).toBe(1);
  });
});

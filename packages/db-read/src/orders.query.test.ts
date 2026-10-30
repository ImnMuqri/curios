import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getCheckout, getOrderByToken, getShopItem, getOrderStats, getOwnerOrders, getOwnerOrdersPage } from './orders.query.js';
import { countNavBadges } from './my-curios.query.js';
import { clearSettingsCache } from './settings.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Sunday 2026-10-18, 23:30 in Malaysia (15:30Z).
const NOW = new Date('2026-10-18T15:30:00Z');

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

  it('does not keep a cancelled RM0 order as one that owes a refund', async () => {
    const owner = await anOwner();
    const free = await anOrder(owner.pageId, { customerName: 'Free', status: 'CANCELLED', paidAt: new Date('2026-01-01T00:00:00Z'), paidVia: 'VOUCHER', cancelledAt: new Date('2026-01-01T00:00:00Z'), totalCents: 0, createdAt: new Date('2026-01-01T00:00:00Z') });
    await write.order.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        pageId: owner.pageId,
        number: 20_000 + i,
        code: `F${i}`,
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
    const ids = (await getOwnerOrders(owner.accountId, { limit: 100 })).map((o) => o.id);
    expect(ids).not.toContain(free);
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

describe('getOwnerOrdersPage', () => {
  it('pages through the finished orders once each, ties included, with what needs the owner on the first page only', async () => {
    const owner = await anOwner();
    const at = new Date('2026-10-05T00:00:00Z');
    for (const name of ['D1', 'D2', 'D3', 'D4', 'D5']) await anOrder(owner.pageId, { customerName: name, status: 'COMPLETED', paidAt: at, createdAt: at });
    await anOrder(owner.pageId, { customerName: 'Open', createdAt: new Date('2026-09-01T00:00:00Z') });

    const first = (await getOwnerOrdersPage(owner.accountId, { perPage: 2 }))!;
    expect(first.orders.map((o) => o.customerName)).toContain('Open');
    expect(first.orders).toHaveLength(3);
    const second = (await getOwnerOrdersPage(owner.accountId, { perPage: 2, before: first.older! }))!;
    const third = (await getOwnerOrdersPage(owner.accountId, { perPage: 2, before: second.older! }))!;
    expect(third.older).toBeNull();
    const done = [...first.orders, ...second.orders, ...third.orders].map((o) => o.customerName).filter((n) => n !== 'Open');
    expect(done.sort()).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    expect([...second.orders, ...third.orders].map((o) => o.customerName)).not.toContain('Open');
  });

  it('has no older page when everything fits, and pages nothing from a cursor that is not this owner’s finished order', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    await anOrder(owner.pageId, { customerName: 'Open' });
    const theirs = await anOrder(other.pageId, { customerName: 'Theirs', status: 'COMPLETED', paidAt: NOW });
    const page = (await getOwnerOrdersPage(owner.accountId))!;
    expect(page.older).toBeNull();
    expect(await getOwnerOrdersPage(owner.accountId, { before: page.orders[0]!.id })).toBeNull();
    expect(await getOwnerOrdersPage(owner.accountId, { before: theirs })).toBeNull();
  });
});

describe('getOwnerOrders, digital orders', () => {
  it('reads what the Sent by email card needs: downloads spent over every grant, link opened, the codes, the booking and the other times with room', async () => {
    const owner = await anOwner();
    const item = await write.item.create({ data: { pageId: owner.pageId, name: 'Pack', slug: `pack-${randomUUID().slice(0, 6)}`, priceCents: 2500, kind: 'DIGITAL', delivery: 'SESSION', position: 0 } });
    const file = await write.itemFile.create({ data: { itemId: item.id, key: 'k/a.pdf', name: 'a.pdf', sizeBytes: 100, contentType: 'application/pdf', position: 0 } });
    const orderId = await anOrder(owner.pageId, { method: null, day: null, email: 'mira@example.com', status: 'PAID', paidAt: NOW, sentAt: NOW, lines: { create: [] } });
    const mk = (position: number, extra: Record<string, unknown>) =>
      write.orderLine.create({ data: { orderId, itemId: item.id, itemName: 'Pack', unitPriceCents: 2500, quantity: 1, position, kind: 'DIGITAL', ...extra }, select: { id: true } });
    const files = await mk(0, { delivery: 'FILES' });
    const codes = await mk(1, { delivery: 'CODES' });
    const session = await mk(2, { delivery: 'SESSION' });
    const link = await mk(3, { delivery: 'LINK', accessUrl: 'https://course.example/secret', linkOpenedAt: NOW });
    // An old grant with 3 uses spent and the fresh one with 1: four downloads of the one file, 4 left on the newest.
    await write.downloadGrant.create({ data: { token: randomUUID(), orderLineId: files.id, fileId: file.id, fileName: 'a.pdf', usesLeft: 2, expiresAt: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z') } });
    await write.downloadGrant.create({ data: { token: randomUUID(), orderLineId: files.id, fileId: file.id, fileName: 'a.pdf', usesLeft: 4, expiresAt: new Date('2026-11-20T00:00:00Z'), createdAt: new Date('2026-10-10T00:00:00Z') } });
    await write.itemCode.create({ data: { itemId: item.id, code: 'GIVEN-1', orderLineId: codes.id, givenAt: NOW } });
    await write.itemCode.create({ data: { itemId: item.id, code: 'FREE-1' } });
    await write.itemCode.create({ data: { itemId: item.id, code: 'FREE-2' } });
    const mine1 = await write.itemSession.create({ data: { itemId: item.id, startsAt: new Date('2026-11-07T12:00:00Z'), seats: 5 } });
    await write.sessionBooking.create({ data: { sessionId: mine1.id, orderLineId: session.id, seats: 1 } });
    const roomy = await write.itemSession.create({ data: { itemId: item.id, startsAt: new Date('2026-11-14T12:00:00Z'), seats: 5 } });
    const full = await write.itemSession.create({ data: { itemId: item.id, startsAt: new Date('2026-11-21T12:00:00Z'), seats: 1 } });
    const other = await anOrder(owner.pageId);
    const otherLine = await write.orderLine.create({ data: { orderId: other, itemId: item.id, itemName: 'Pack', unitPriceCents: 2500, quantity: 1, position: 0, kind: 'DIGITAL', delivery: 'SESSION' }, select: { id: true } });
    await write.sessionBooking.create({ data: { sessionId: full.id, orderLineId: otherLine.id, seats: 1 } });
    await write.itemSession.create({ data: { itemId: item.id, startsAt: new Date('2026-10-01T12:00:00Z'), seats: 5 } });

    const [order] = (await getOwnerOrders(owner.accountId, { now: NOW })).filter((o) => o.id === orderId);
    expect(order).toMatchObject({ email: 'mira@example.com', sentAt: NOW, method: null, day: null });
    const pick = (id: string) => order?.lines.find((l) => l.id === id)?.digital;
    expect(pick(files.id)?.files).toEqual([{ name: 'a.pdf', used: 4, left: 4, expiresAt: new Date('2026-11-20T00:00:00Z') }]);
    expect(pick(codes.id)).toMatchObject({ codes: ['GIVEN-1'], codesLeft: 2 });
    expect(pick(link.id)).toMatchObject({ linkOpenedAt: NOW });
    expect(JSON.stringify(order)).not.toContain('course.example');
    expect(pick(session.id)?.session).toMatchObject({ startsAt: new Date('2026-11-07T12:00:00Z'), seats: 1, remindedAt: null });
    // Not its own time, not the full one, not a past one.
    expect(pick(session.id)?.times).toEqual([{ id: roomy.id, startsAt: new Date('2026-11-14T12:00:00Z'), seatsLeft: 5 }]);
  });

  it('gives a physical line no digital part', async () => {
    const owner = await anOwner();
    await anOrder(owner.pageId);
    const [order] = await getOwnerOrders(owner.accountId);
    expect(order?.lines[0]?.digital).toBeNull();
    expect(order).toMatchObject({ email: null, sentAt: null });
  });

  it('treats a sent digital-only order as done, and a sent mixed one as still to make', async () => {
    const owner = await anOwner();
    const digitalLine = { itemName: 'E-book', unitPriceCents: 2500, quantity: 1, position: 0, kind: 'DIGITAL' as const, delivery: 'LINK' as const };
    const sent = await anOrder(owner.pageId, { method: null, day: null, status: 'PAID', paidAt: NOW, sentAt: NOW, createdAt: new Date('2026-01-01T00:00:00Z'), lines: { create: [digitalLine] } });
    const mixed = await anOrder(owner.pageId, {
      status: 'PAID',
      paidAt: NOW,
      sentAt: NOW,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      lines: { create: [digitalLine, { itemName: 'Kek', unitPriceCents: 5000, quantity: 1, position: 1 }] },
    });
    expect((await getOrderStats(owner.accountId, NOW)).toMake).toBe(1);
    // Beyond the cap of finished orders, the mixed one is still listed: it needs the owner. The sent one is a finished order.
    const listed = await getOwnerOrders(owner.accountId, { limit: 0 });
    expect(listed.map((o) => o.id)).toEqual([mixed]);
    expect((await getOwnerOrders(owner.accountId)).map((o) => o.id).sort()).toEqual([sent, mixed].sort());
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

  it('returns what a voucher took off and its label, and 0 and null on an order with none', async () => {
    const owner = await anOwner();
    const voucher = await write.shopVoucher.create({ data: { pageId: owner.pageId, mode: 'CODE', code: 'RAYA', kind: 'AMOUNT', amountCents: 500 } });
    const token = randomUUID();
    await anOrder(owner.pageId, { totalCents: 4500, discountCents: 500, voucherId: voucher.id, voucherLabel: 'RAYA', status: 'PAID', paidAt: NOW, paidVia: 'VOUCHER' }, token);
    expect(await getOrderByToken(token)).toMatchObject({ itemsCents: 5000, totalCents: 4500, discountCents: 500, voucherLabel: 'RAYA', paidVia: 'VOUCHER' });
    const plainToken = randomUUID();
    await anOrder(owner.pageId, {}, plainToken);
    expect(await getOrderByToken(plainToken)).toMatchObject({ discountCents: 0, voucherLabel: null });
    const orders = await getOwnerOrders(owner.accountId);
    expect(orders.map((o) => [o.discountCents, o.voucherLabel]).sort()).toEqual([[0, null], [500, 'RAYA']]);
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

  it('reads a digital order from its lines: the newest grant per file, the given codes, the booked time, and nothing handed out before payment', async () => {
    const owner = await anOwner();
    const item = await write.item.create({ data: { pageId: owner.pageId, name: 'Pack', slug: `pack-${randomUUID().slice(0, 6)}`, priceCents: 2500, kind: 'DIGITAL', delivery: 'FILES', position: 0 } });
    const file = await write.itemFile.create({ data: { itemId: item.id, key: 'k/a.pdf', name: 'a.pdf', sizeBytes: 4_400_000, contentType: 'application/pdf', position: 0 } });
    const token = randomUUID();
    const orderId = await anOrder(owner.pageId, { method: null, day: null, email: 'mira@example.com', lines: { create: [] } }, token);
    const mk = (position: number, extra: Record<string, unknown>) =>
      write.orderLine.create({ data: { orderId, itemId: item.id, itemName: 'Pack', unitPriceCents: 2500, quantity: 1, position, kind: 'DIGITAL', ...extra }, select: { id: true } });
    const files = await mk(0, { delivery: 'FILES' });
    const codes = await mk(1, { delivery: 'CODES' });
    const session = await mk(2, { delivery: 'SESSION', sessionMinutes: 60, sessionPlace: 'ONLINE', sessionWhere: 'https://meet.example/x' });
    const link = await mk(3, { delivery: 'LINK', accessUrl: 'https://course.example/secret', accessNote: 'Watch in order' });
    await write.downloadGrant.create({ data: { token: randomUUID(), orderLineId: files.id, fileId: file.id, fileName: 'a.pdf', usesLeft: 0, expiresAt: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z') } });
    const fresh = await write.downloadGrant.create({ data: { token: randomUUID(), orderLineId: files.id, fileId: file.id, fileName: 'a.pdf', usesLeft: 5, expiresAt: new Date('2026-11-20T00:00:00Z'), createdAt: new Date('2026-10-10T00:00:00Z') } });
    await write.itemCode.create({ data: { itemId: item.id, code: 'GIVEN-1', orderLineId: codes.id, givenAt: NOW } });
    await write.itemCode.create({ data: { itemId: item.id, code: 'HELD-2', orderLineId: codes.id } });
    const slot = await write.itemSession.create({ data: { itemId: item.id, startsAt: new Date('2026-11-07T12:00:00Z'), seats: 5 } });
    await write.sessionBooking.create({ data: { sessionId: slot.id, orderLineId: session.id, seats: 1 } });

    // Unpaid: the booked time and the note show, but no code, place or download.
    const before = await getOrderByToken(token);
    const pick = (o: typeof before, id: string) => o?.lines.find((l) => l.id === id);
    expect(before).toMatchObject({ email: 'mira@example.com', sentAt: null, method: null, day: null });
    expect(pick(before, codes.id)?.codes).toEqual([]);
    expect(pick(before, files.id)?.grants).toEqual([]);
    expect(pick(before, link.id)).toMatchObject({ accessNote: null, hasLink: true });
    expect(JSON.stringify(before)).not.toContain('Watch in order');
    expect(pick(before, session.id)).toMatchObject({ sessionWhere: null, sessionMinutes: 60, sessionStartsAt: new Date('2026-11-07T12:00:00Z') });

    await write.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: NOW, sentAt: NOW } });
    const after = await getOrderByToken(token);
    // Only the given code; only the newest grant of the file, with the file's size.
    expect(pick(after, codes.id)?.codes).toEqual(['GIVEN-1']);
    expect(pick(after, files.id)?.grants).toEqual([{ id: fresh.id, fileName: 'a.pdf', sizeBytes: 4_400_000, usesLeft: 5, expiresAt: new Date('2026-11-20T00:00:00Z') }]);
    expect(pick(after, session.id)?.sessionWhere).toBe('https://meet.example/x');
    expect(pick(after, link.id)).toMatchObject({ hasLink: true, accessNote: 'Watch in order' });
    // The private link itself never leaves; the API's link route opens it.
    expect(JSON.stringify(after)).not.toContain('course.example');
    expect(after?.sentAt).toEqual(NOW);
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

  it('counts the free orders the admin set: with 5, a page with 3 placed still takes orders', async () => {
    const owner = await anOwner({ ordersPlaced: 3 });
    await withSetting('freeOrders', 5, async () => {
      expect((await getCheckout(owner.handle, NOW))?.canTakeOrders).toBe(true);
    });
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

  it('gives the item page its squares in order, or the cover alone, or nothing', async () => {
    const owner = await anOwner();
    await anItem(owner.pageId, 'Cake', 'cake', {
      photoKey: 'items/p/cover.webp',
      photos: { create: [
        { position: 1, originalKey: 'private/o2', squareKey: 'items/p/sq2.webp', width: 1000, height: 1000, frameX: 0, frameY: 0, frameSize: 1000 },
        { position: 0, originalKey: 'private/o1', squareKey: 'items/p/sq1.webp', width: 1000, height: 1000, frameX: 0, frameY: 0, frameSize: 1000 },
      ] },
    });
    await anItem(owner.pageId, 'Old', 'old', { photoKey: 'items/p/old.webp' });
    await anItem(owner.pageId, 'Bare', 'bare');
    expect((await getShopItem(owner.handle, 'cake', NOW))?.photoKeys).toEqual(['items/p/sq1.webp', 'items/p/sq2.webp']);
    expect((await getShopItem(owner.handle, 'old', NOW))?.photoKeys).toEqual(['items/p/old.webp']);
    expect((await getShopItem(owner.handle, 'bare', NOW))?.photoKeys).toEqual([]);
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

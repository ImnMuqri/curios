import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EXPIRE_HOLDS_JOB, expireUnpaidHolds } from './expire-holds.js';
import { scheduleHousekeepingJobs } from './retention.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const now = new Date('2026-10-25T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

let accountId = '';
let pageId = '';
let codeItem = '';
let classItem = '';
let time = '';
let cappedWindow = '';
let openWindow = '';
let n = 0;

beforeAll(async () => {
  const slug = `eh${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `eh-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Holds',
          items: {
            create: [
              { name: 'Voucher', slug: 'v', position: 0, priceCents: 500, kind: 'DIGITAL', delivery: 'CODES' },
              { name: 'Class', slug: 'c', position: 1, priceCents: 500, kind: 'DIGITAL', delivery: 'SESSION', sessions: { create: { startsAt: new Date('2026-12-01T12:00:00Z'), seats: 50 } } },
            ],
          },
        },
      },
    },
    select: { id: true, pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true, sessions: { select: { id: true } } } } } } },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
  codeItem = account.pages[0]!.items[0]!.id;
  classItem = account.pages[0]!.items[1]!.id;
  time = account.pages[0]!.items[1]!.sessions[0]!.id;
  const place = await prisma.pickupPlace.create({
    data: {
      pageId,
      name: 'Kedai',
      address: '1 Jalan Holds',
      anyTime: false,
      position: 0,
      windows: {
        create: [
          { fromMinute: 600, toMinute: 720, limit: 3, position: 0 },
          { fromMinute: 720, toMinute: 840, limit: null, position: 1 },
        ],
      },
    },
    select: { windows: { orderBy: { position: 'asc' }, select: { id: true } } },
  });
  cappedWindow = place.windows[0]!.id;
  openWindow = place.windows[1]!.id;
});
afterAll(async () => {
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

/** An order made `age` minutes ago, holding a code and a seat unless told not to. */
async function anOrder(age: number, data: Record<string, unknown> = {}, holds = true) {
  n += 1;
  const order = await prisma.order.create({
    data: {
      pageId,
      number: n,
      code: `H${n}`,
      tokenHash: `eh-${randomUUID()}`,
      customerName: 'Aina',
      phone: '+60123456789',
      email: 'a@example.com',
      itemsCents: 500,
      deliveryCents: 0,
      totalCents: 500,
      createdAt: minutesAgo(age),
      lines: {
        create: [
          { itemId: codeItem, itemName: 'Voucher', unitPriceCents: 500, quantity: 1, position: 0, kind: 'DIGITAL', delivery: 'CODES' },
          { itemId: classItem, itemName: 'Class', unitPriceCents: 500, quantity: 1, position: 1, kind: 'DIGITAL', delivery: 'SESSION' },
        ],
      },
      ...data,
    },
    select: { id: true, lines: { orderBy: { position: 'asc' }, select: { id: true } } },
  });
  if (holds) {
    await prisma.itemCode.create({ data: { itemId: codeItem, code: `C-${randomUUID()}`, orderLineId: order.lines[0]!.id } });
    await prisma.sessionBooking.create({ data: { sessionId: time, orderLineId: order.lines[1]!.id, seats: 1 } });
  }
  return order.id;
}
const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
const held = (id: string) => prisma.itemCode.count({ where: { orderLine: { orderId: id } } });
const booked = (id: string) => prisma.sessionBooking.count({ where: { orderLine: { orderId: id } } });

describe('expireUnpaidHolds', () => {
  it('cancels a 31-minute-old unpaid order holding a code and a seat, and gives both back', async () => {
    const id = await anOrder(31);
    expect(await expireUnpaidHolds({ prisma, now })).toBeGreaterThanOrEqual(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('CANCELLED');
    expect(order.cancelledAt?.toISOString()).toBe(now.toISOString());
    expect(await held(id)).toBe(0);
    expect(await booked(id)).toBe(0);
    expect(await prisma.itemCode.count({ where: { itemId: codeItem, orderLineId: null } })).toBeGreaterThanOrEqual(1);
  });

  it('leaves alone an order with a receipt, a live CHIP purchase, paid, younger than 30 minutes, or holding nothing', async () => {
    const receipt = await anOrder(31, { receiptKey: 'r/x.jpg', receiptType: 'image/jpeg', receiptUploadedAt: minutesAgo(2) });
    const live = await anOrder(31, { chipPurchaseId: 'p1', chipPurchaseDueAt: new Date(now.getTime() + 600_000) });
    const paid = await anOrder(31, { status: 'PAID', paidAt: minutesAgo(1) });
    const young = await anOrder(29);
    const empty = await anOrder(31, {}, false);
    await expireUnpaidHolds({ prisma, now });
    expect(await status(receipt)).toBe('PLACED');
    expect(await status(live)).toBe('PLACED');
    expect(await status(paid)).toBe('PAID');
    expect(await status(young)).toBe('PLACED');
    expect(await status(empty)).toBe('PLACED');
    for (const id of [receipt, live, paid, young]) {
      expect(await held(id)).toBe(1);
      expect(await booked(id)).toBe(1);
    }
  });

  it('takes one whose CHIP purchase is past due, keeping its purchase id so a late payment is recorded on it', async () => {
    const id = await anOrder(31, { chipPurchaseId: 'p-late', chipPurchaseDueAt: minutesAgo(1) });
    await expireUnpaidHolds({ prisma, now });
    // Exactly what settleChipPurchase's paid-after-cancel update looks for.
    expect(await prisma.order.count({ where: { id, status: 'CANCELLED', paidAt: null, chipPurchaseId: 'p-late' } })).toBe(1);
  });

  it('takes one holding a place in a pickup window with a limit, and leaves one whose window has none', async () => {
    const capped = await anOrder(31, { method: 'PICKUP', pickupWindowId: cappedWindow }, false);
    const open = await anOrder(31, { method: 'PICKUP', pickupWindowId: openWindow }, false);
    const sent = await anOrder(31, { method: 'PICKUP', pickupWindowId: cappedWindow, receiptKey: 'r/y.jpg', receiptType: 'image/jpeg', receiptUploadedAt: minutesAgo(2) }, false);
    await expireUnpaidHolds({ prisma, now });
    expect(await status(capped)).toBe('CANCELLED');
    expect(await status(open)).toBe('PLACED');
    expect(await status(sent)).toBe('PLACED');
  });

  it('runs twice safely', async () => {
    const id = await anOrder(40);
    await expireUnpaidHolds({ prisma, now });
    expect(await expireUnpaidHolds({ prisma, now })).toBe(0);
    expect(await status(id)).toBe('CANCELLED');
  });

  it('is scheduled every 5 minutes', async () => {
    const queue = { upsertJobScheduler: vi.fn(async () => ({})) };
    await scheduleHousekeepingJobs(queue);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(EXPIRE_HOLDS_JOB, { pattern: '*/5 * * * *' }, { name: EXPIRE_HOLDS_JOB });
  });
});

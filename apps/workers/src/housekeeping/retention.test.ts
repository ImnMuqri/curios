import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { retentionCutoff, runRetention } from './retention.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const now = new Date('2027-10-18T03:00:00Z');
const old = new Date('2026-10-17T03:00:00Z');
const recent = new Date('2026-10-19T03:00:00Z');

let accountId = '';
let pageId = '';

beforeAll(async () => {
  const account = await prisma.account.create({
    data: {
      email: `ret-${randomUUID()}@example.com`,
      pages: { create: { handle: `r${randomUUID().slice(0, 8)}`, skeleton: `r${randomUUID().slice(0, 8)}`, displayName: 'Retention' } },
    },
    include: { pages: true },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
});

afterAll(async () => {
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

/** A conversation from `at`, with one message and, if asked, a lead. */
async function aConversation(at: Date, lead: boolean) {
  const conversation = await prisma.conversation.create({
    data: {
      pageId,
      createdAt: at,
      messages: { create: { role: 'USER', content: 'boleh hantar ke klang?', createdAt: at } },
      ...(lead ? { lead: { create: { pageId, phone: '+60127814402', createdAt: at } } } : {}),
    },
  });
  return conversation.id;
}

let orders = 0;
/** An order placed at `at`, with one line and, if given, a receipt's object key. */
async function anOrder(at: Date, receiptKey: string | null) {
  orders += 1;
  return prisma.order.create({
    data: {
      pageId,
      number: orders,
      code: `R${orders}`,
      tokenHash: `retention-${randomUUID()}`,
      customerName: 'Aina',
      phone: '+60123456789',
      method: 'PICKUP',
      day: at,
      itemsCents: 4500,
      deliveryCents: 0,
      totalCents: 4500,
      receiptKey,
      receiptType: receiptKey ? 'image/jpeg' : null,
      createdAt: at,
      lines: { create: { itemName: 'Kek batik', unitPriceCents: 4500, quantity: 1, position: 0 } },
    },
    select: { id: true, receiptKey: true },
  });
}

describe('retentionCutoff', () => {
  it('is twelve months before now', () => {
    expect(retentionCutoff(now).toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });
});

describe('runRetention', () => {
  it('deletes leads and messages past twelve months, with their emptied conversations, and keeps the rest', async () => {
    const gone = await aConversation(old, true);
    const kept = await aConversation(recent, true);

    await runRetention({ prisma, now });

    expect(await prisma.conversation.findUnique({ where: { id: gone } })).toBeNull();
    expect(await prisma.lead.count({ where: { conversationId: gone } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: gone } })).toBe(0);

    expect(await prisma.lead.count({ where: { conversationId: kept } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: kept } })).toBe(1);
  });

  it('deletes orders past 12 months, and their receipts', async () => {
    const withReceipt = await anOrder(old, `receipts/${pageId}/${randomUUID()}.jpg`);
    const noReceipt = await anOrder(old, null);
    const keptKey = `receipts/${pageId}/${randomUUID()}.png`;
    const kept = await anOrder(recent, keptKey);
    const removeObjects = vi.fn(async (_keys: string[]) => ({ failed: [] as string[] }));

    const result = await runRetention({ prisma, now, removeObjects });

    expect(await prisma.order.findMany({ where: { id: { in: [withReceipt.id, noReceipt.id, kept.id] } }, select: { id: true } })).toEqual([{ id: kept.id }]);
    expect(await prisma.orderLine.count({ where: { orderId: { in: [withReceipt.id, noReceipt.id] } } })).toBe(0);
    // Rows first, then the files: the deleted order's receipt goes, the kept one's stays.
    // (Containment, not equality: the sweep is database-wide, and another
    // package's tests may have left an old order behind.)
    expect(removeObjects).toHaveBeenCalledTimes(1);
    const keys = removeObjects.mock.calls[0]![0];
    expect(keys).toContain(withReceipt.receiptKey);
    expect(keys).not.toContain(keptKey);
    expect(result.orders).toBeGreaterThanOrEqual(2);
    expect(result.receipts).toBe(keys.length);
  });

  it('still deletes the orders when a receipt cannot be removed, and logs which', async () => {
    const order = await anOrder(old, `receipts/${pageId}/${randomUUID()}.webp`);
    const warn = vi.fn();

    await runRetention({ prisma, now, removeObjects: async (keys) => ({ failed: keys }), log: { warn } });

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
    expect(warn).toHaveBeenCalledWith({ failed: expect.arrayContaining([order.receiptKey]) }, expect.stringMatching(/receipt/));
  });

  it('deletes the orders with no file to remove when storage is off', async () => {
    const order = await anOrder(old, `receipts/${pageId}/${randomUUID()}.pdf`);

    await runRetention({ prisma, now, removeObjects: null });

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
  });

  it('keeps an old conversation that still has recent messages, dropping only the old ones', async () => {
    const id = await aConversation(old, false);
    await prisma.message.create({ data: { conversationId: id, role: 'ASSISTANT', content: 'Ya, RM10.', createdAt: recent } });

    await runRetention({ prisma, now });

    expect(await prisma.conversation.findUnique({ where: { id } })).not.toBeNull();
    expect(await prisma.message.findMany({ where: { conversationId: id }, select: { content: true } })).toEqual([{ content: 'Ya, RM10.' }]);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOwnerView } from './owner-view.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-10-21T02:00:00.000Z');
let pageId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const handle = 'ovw-fixture';
  const account = await write.account.create({
    data: {
      email: 'owner@example.com',
      pages: { create: { handle, skeleton: handle, displayName: 'Dapur Kak Nor', bio: 'Home baker', mode: 'BUSINESS', published: true, leadsCaptured: 1 } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]!.id;

  await write.link.create({ data: { pageId, label: 'Instagram', url: 'https://instagram.com/nor', position: 0 } });
  await write.fact.createMany({
    data: [
      { pageId, category: 'HOURS', claim: 'Open 9 to 5', normalizedClaim: 'a', confidence: 1, verified: true },
      { pageId, category: 'MISC', claim: 'Maybe halal', normalizedClaim: 'b', confidence: 0.4 },
      { pageId, category: 'MISC', claim: 'Wrong thing', normalizedClaim: 'c', confidence: 0.4, rejectedAt: NOW },
    ],
  });
  await write.item.create({ data: { pageId, name: 'Kek Lapis', slug: 'kek-lapis', priceCents: 45, position: 0, available: false } });

  const conversation = await write.conversation.create({ data: { pageId, createdAt: new Date('2026-10-10T00:00:00Z') } });
  await write.message.create({ data: { conversationId: conversation.id, role: 'USER', content: 'SECRETMESSAGE call me at wati.customer@gmail.com' } });
  await write.lead.create({
    data: {
      pageId,
      conversationId: conversation.id,
      phone: '+60198765432',
      slots: { product: 'SECRETPRODUCT', date: null, location: 'Shah Alam' },
      createdAt: new Date('2026-10-12T00:00:00Z'),
    },
  });
  await write.order.create({
    data: {
      pageId,
      number: 7,
      code: 'AB12',
      tokenHash: randomUUID(),
      customerName: 'Aisyah Rahman',
      phone: '+60112233445',
      method: 'DELIVERY',
      day: new Date('2026-10-22'),
      address: '12 SECRETROAD, Shah Alam',
      note: 'SECRETNOTE',
      itemsCents: 45,
      deliveryCents: 5,
      totalCents: 50,
      receiptKey: 'receipts/secret-key',
      status: 'PAID',
      createdAt: new Date('2026-10-13T00:00:00Z'),
    },
  });
  await write.usageCounter.create({ data: { pageId, period: '2026-10', count: 1 } });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getOwnerView', () => {
  it('shows the page, its plan and usage, facts, items, leads, orders and conversations', async () => {
    const view = await getOwnerView(pageId, NOW);
    expect(view?.profile).toMatchObject({ handle: 'ovw-fixture', displayName: 'Dapur Kak Nor', mode: 'BUSINESS', links: [{ label: 'Instagram', url: 'https://instagram.com/nor' }] });
    expect(view?.plan).toMatchObject({ plan: 'Business trial', conversationsThisMonth: 1, leadsThisMonth: 1, ordersThisMonth: 1 });
    expect(view?.facts.map((f) => [f.text, f.status]).sort()).toEqual([
      ['Maybe halal', 'Pending'],
      ['Open 9 to 5', 'Live'],
      ['Wrong thing', 'Rejected'],
    ]);
    expect(view?.items).toEqual([{ name: 'Kek Lapis', priceCents: 45, available: false }]);
    expect(view?.leads).toEqual([{ maskedPhone: '+60••••••32', createdAt: new Date('2026-10-12T00:00:00Z'), slotsFilled: ['product', 'location'] }]);
    expect(view?.orders).toEqual([{ number: 7, maskedName: 'A. R.', totalCents: 50, status: 'PAID', createdAt: new Date('2026-10-13T00:00:00Z') }]);
    expect(view?.conversations).toEqual({ thisMonth: 1, latest: [new Date('2026-10-10T00:00:00Z')] });
  });

  it('never carries a phone, a customer email, a message, an address or a receipt', async () => {
    const json = JSON.stringify(await getOwnerView(pageId, NOW));
    // Strip ISO timestamps and the cap, then no run of three or more digits may remain.
    expect(json.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '').replace(/"cap":\d+/, '')).not.toMatch(/\d{3,}/);
    for (const leak of ['98765432', '0198', '11223344', 'wati.customer', 'gmail', 'SECRETMESSAGE', 'SECRETPRODUCT', 'SECRETROAD', 'SECRETNOTE', 'Aisyah', 'Rahman', 'receipts/', 'AB12']) {
      expect(json).not.toContain(leak);
    }
  });

  it('is null for an unknown page', async () => {
    expect(await getOwnerView('nope', NOW)).toBeNull();
  });
});

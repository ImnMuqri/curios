import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LEAD_QUEUE, type LeadJobData } from '@curios/core';
import { buildApp } from '../../app.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

/** Every job the enquiry route queued, in place of BullMQ: nothing reaches Redis or a worker. */
let queued: { name: string; data: LeadJobData; opts: unknown }[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeQueue() {
  queued = [];
  vi.spyOn(app.leadQueue, 'add').mockImplementation(async (name, data, opts) => {
    queued.push({ name, data, opts });
    return {} as never;
  });
}

interface ShopOptions {
  mode?: 'BUSINESS' | 'PERSONAL';
  storeEnabled?: boolean;
  published?: boolean;
  paidUntil?: Date | null;
  leadsCaptured?: number;
}

/**
 * A published business page with its shop open, holding an Ask item (Kek kahwin, from RM180), a basket item,
 * a switched-off Ask item and a digital item marked ask (as only a direct write could make one). Handles are
 * randomUUID-derived, as the other suites sharing this database do.
 */
async function aShop(options: ShopOptions = {}) {
  const handle = `eq-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `enquiry-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          published: options.published ?? true,
          mode: options.mode ?? 'BUSINESS',
          storeEnabled: options.storeEnabled ?? true,
          paidUntil: options.paidUntil ?? null,
          leadsCaptured: options.leadsCaptured ?? 0,
        },
      },
    },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  const item = (data: { name: string; askForPrice: boolean; priceCents: number | null; available?: boolean; kind?: 'PHYSICAL' | 'DIGITAL' }, position: number) =>
    app.prisma.item.create({
      data: { pageId, slug: `${data.name.toLowerCase().replace(/\s+/g, '-')}-${position}`, position, ...data, ...(data.kind === 'DIGITAL' ? { delivery: 'LINK', accessUrl: 'https://example.com/x' } : {}) },
      select: { id: true },
    });
  const ask = await item({ name: 'Kek kahwin', askForPrice: true, priceCents: 18_000 }, 0);
  const other = await item({ name: 'Kek hari jadi', askForPrice: true, priceCents: null }, 1);
  const basket = await item({ name: 'Tart nenas', askForPrice: false, priceCents: 2_000 }, 2);
  const off = await item({ name: 'Kek lapis', askForPrice: true, priceCents: null, available: false }, 3);
  const digital = await item({ name: 'Resipi e-book', askForPrice: true, priceCents: null, kind: 'DIGITAL' }, 4);
  return { handle, pageId, askId: ask.id, otherAskId: other.id, basketId: basket.id, offId: off.id, digitalId: digital.id };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const body = (shop: Shop, over: Record<string, unknown> = {}) => ({
  itemId: shop.askId,
  message: '  Kek 3 tingkat untuk 150 orang, 20 Disember. Bajet sekitar RM800.  ',
  name: '  Aisyah   binti Ali ',
  phone: '012-345 6789',
  consent: true,
  ...over,
});

const send = (handle: string, payload: object) =>
  app.inject({ method: 'POST', url: `/enquiries/${handle}`, remoteAddress: from(), payload });

const leadsCaptured = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { leadsCaptured: true } })).leadsCaptured;

describe('POST /enquiries/:handle', () => {
  it('makes a conversation holding the enquiry, an ENQUIRY lead on it, counts it and queues the lead job', async () => {
    fakeQueue();
    const shop = await aShop();

    const res = await send(shop.handle, body(shop));

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ conversationId: expect.any(String) });
    const conversationId = res.json().conversationId as string;

    const conversation = await app.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { pageId: true, messages: { select: { role: true, content: true } } },
    });
    expect(conversation.pageId).toBe(shop.pageId);
    expect(conversation.messages).toEqual([
      { role: 'USER', content: 'Enquiry from the shop: Kek kahwin. Kek 3 tingkat untuk 150 orang, 20 Disember. Bajet sekitar RM800.' },
    ]);

    const lead = await app.prisma.lead.findUniqueOrThrow({
      where: { conversationId },
      select: { id: true, pageId: true, kind: true, itemId: true, name: true, note: true, phone: true },
    });
    expect(lead).toEqual({
      id: expect.any(String),
      pageId: shop.pageId,
      kind: 'ENQUIRY',
      itemId: shop.askId,
      name: 'Aisyah binti Ali',
      note: 'Kek 3 tingkat untuk 150 orang, 20 Disember. Bajet sekitar RM800.',
      phone: '+60123456789',
    });
    expect(await leadsCaptured(shop.pageId)).toBe(1);

    expect(queued).toEqual([{ name: LEAD_QUEUE, data: { leadId: lead.id }, opts: { jobId: lead.id, attempts: 3 } }]);
  });

  it('marks the job lastFreeLead when the enquiry spends the last free lead, as a capture does', async () => {
    fakeQueue();
    const { freeLeads } = await app.settings.get();
    const before = await aShop({ leadsCaptured: freeLeads - 2 });
    expect((await send(before.handle, body(before))).statusCode).toBe(201);
    expect(queued[0]?.data).not.toHaveProperty('lastFreeLead');

    fakeQueue();
    const last = await aShop({ leadsCaptured: freeLeads - 1 });
    expect((await send(last.handle, body(last))).statusCode).toBe(201);
    expect(queued[0]?.data).toMatchObject({ lastFreeLead: true, freeLeads });
    expect(await leadsCaptured(last.pageId)).toBe(freeLeads);
  });

  it('a paid page past its free leads still takes one, and never says lastFreeLead', async () => {
    fakeQueue();
    const { freeLeads } = await app.settings.get();
    const shop = await aShop({ paidUntil: new Date(Date.now() + 30 * 86_400_000), leadsCaptured: freeLeads + 4 });
    expect((await send(shop.handle, body(shop))).statusCode).toBe(201);
    expect(queued[0]?.data).not.toHaveProperty('lastFreeLead');
  });

  it('refuses with 409 ENQUIRIES_PAUSED when the plan cannot capture: trial leads used up, or lapsed', async () => {
    fakeQueue();
    const { freeLeads } = await app.settings.get();
    const spent = await aShop({ leadsCaptured: freeLeads });
    const lapsed = await aShop({ paidUntil: new Date(Date.now() - 86_400_000), leadsCaptured: freeLeads });
    for (const shop of [spent, lapsed]) {
      const res = await send(shop.handle, body(shop));
      expect(res.statusCode).toBe(409);
      // The code and its own sentence reach the shop, which says to ask on the page instead.
      expect(res.json().error).toEqual({ code: 'ENQUIRIES_PAUSED', message: expect.stringMatching(/Ask on the page/) });
      expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
      expect(await app.prisma.conversation.count({ where: { pageId: shop.pageId } })).toBe(0);
      expect(await leadsCaptured(shop.pageId)).toBe(freeLeads);
    }
    expect(queued).toEqual([]);
  });

  it('refuses an item that is not an Ask item, switched off, digital or another page\'s with 404 ITEM_UNAVAILABLE', async () => {
    fakeQueue();
    const shop = await aShop();
    const other = await aShop();
    for (const itemId of [shop.basketId, shop.offId, shop.digitalId, other.askId, 'nope']) {
      const res = await send(shop.handle, body(shop, { itemId }));
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('ITEM_UNAVAILABLE');
    }
    expect(await app.prisma.lead.count({ where: { pageId: { in: [shop.pageId, other.pageId] } } })).toBe(0);
    expect(await leadsCaptured(shop.pageId)).toBe(0);
    expect(queued).toEqual([]);
  });

  it('refuses a personal page, a closed store, an unpublished page and an unknown handle with 404', async () => {
    fakeQueue();
    const personal = await aShop({ mode: 'PERSONAL' });
    const closed = await aShop({ storeEnabled: false });
    const draft = await aShop({ published: false });
    for (const shop of [personal, closed, draft]) {
      const res = await send(shop.handle, body(shop));
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('ITEM_UNAVAILABLE');
      expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
    }
    const unknown = await send(`nobody-${randomUUID().slice(0, 8)}`, body(personal));
    expect(unknown.statusCode).toBe(404);
    expect(queued).toEqual([]);
  });

  it('refuses a suspended page with 410 PAGE_UNAVAILABLE', async () => {
    fakeQueue();
    const shop = await aShop();
    await app.prisma.page.update({ where: { id: shop.pageId }, data: { suspendedAt: new Date(), suspendReason: 'x' } });
    const res = await send(shop.handle, body(shop));
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('PAGE_UNAVAILABLE');
    expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses a number that is not a Malaysian mobile with 400 INVALID_PHONE', async () => {
    fakeQueue();
    const shop = await aShop();
    const res = await send(shop.handle, body(shop, { phone: '0323456789' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PHONE');
    expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses a blank message, an over-long message or a blank name with 400 INVALID_ENQUIRY', async () => {
    fakeQueue();
    const shop = await aShop();
    for (const over of [{ message: '   ' }, { message: 'x'.repeat(1001) }, { name: '  \n ' }, { name: 'x'.repeat(81) }]) {
      const res = await send(shop.handle, body(shop, over));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ENQUIRY');
    }
    expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
    expect(queued).toEqual([]);
  });

  it('refuses an enquiry without consent', async () => {
    fakeQueue();
    const shop = await aShop();
    const { consent: _consent, ...without } = body(shop);
    for (const payload of [without, body(shop, { consent: false })]) {
      expect((await send(shop.handle, payload)).statusCode).toBe(400);
    }
    expect(await app.prisma.lead.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('one per item per number a day: the same number about the same item is 409 ALREADY_ENQUIRED, another item is its own', async () => {
    fakeQueue();
    const shop = await aShop();
    expect((await send(shop.handle, body(shop))).statusCode).toBe(201);

    // The same number written another way is the same number.
    const again = await send(shop.handle, body(shop, { phone: '+60 12-345 6789', message: 'Lagi satu soalan' }));
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_ENQUIRED');

    expect((await send(shop.handle, body(shop, { itemId: shop.otherAskId }))).statusCode).toBe(201);
    expect((await send(shop.handle, body(shop, { phone: '0199999999' }))).statusCode).toBe(201);

    expect(await app.prisma.lead.count({ where: { pageId: shop.pageId, kind: 'ENQUIRY' } })).toBe(3);
    expect(await leadsCaptured(shop.pageId)).toBe(3);
    expect(queued).toHaveLength(3);
  });

  it('the same item and number again after a day is a new enquiry', async () => {
    fakeQueue();
    const shop = await aShop();
    expect((await send(shop.handle, body(shop))).statusCode).toBe(201);
    await app.prisma.lead.updateMany({ where: { pageId: shop.pageId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect((await send(shop.handle, body(shop))).statusCode).toBe(201);
  });

  it('a number left in the chat does not block an enquiry from the same number', async () => {
    fakeQueue();
    const shop = await aShop();
    const conversation = await app.prisma.conversation.create({ data: { pageId: shop.pageId }, select: { id: true } });
    await app.prisma.lead.create({ data: { pageId: shop.pageId, conversationId: conversation.id, phone: '+60123456789' } });
    expect((await send(shop.handle, body(shop))).statusCode).toBe(201);
  });
});

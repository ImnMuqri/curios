import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashSessionValue, MAIL_QUEUE, type MailJobData } from '@curios/core';
import { malaysiaToday, openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };

let app: FastifyInstance;
let nth = 0;
/** A fresh source address per request, so the per-IP limiter never sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ orders: { mailQueue } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  mailQueue.add.mockClear();
});

interface ShopOptions {
  mode?: 'BUSINESS' | 'PERSONAL';
  storeEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryMode?: 'NONE' | 'FLAT' | 'RIDER';
  deliveryFeeCents?: number | null;
  minNoticeDays?: number;
  closedDays?: number[];
  ordersPlaced?: number;
  notifyOrders?: boolean;
}

/** A business page with a shop open: a cake with two sizes, and tarts at one price. */
async function aShop(options: ShopOptions = {}) {
  const slug = `or-${randomUUID().slice(0, 8)}`;
  const email = `order-${randomUUID()}@example.com`;
  const account = await app.prisma.account.create({
    data: {
      email,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Kek Lina',
          published: true,
          mode: options.mode ?? 'BUSINESS',
          storeEnabled: options.storeEnabled ?? true,
          pickupEnabled: options.pickupEnabled ?? true,
          deliveryMode: options.deliveryMode ?? 'FLAT',
          deliveryFeeCents: options.deliveryFeeCents === undefined ? 1_000 : options.deliveryFeeCents,
          minNoticeDays: options.minNoticeDays ?? 1,
          closedDays: options.closedDays ?? [],
          ordersPlaced: options.ordersPlaced ?? 0,
          notifyOrders: options.notifyOrders ?? true,
          items: {
            create: [
              {
                name: 'Kek coklat moist',
                position: 0,
                options: {
                  create: [
                    { label: '1kg', priceCents: 9_500, position: 0 },
                    { label: '2kg', priceCents: 17_000, position: 1 },
                  ],
                },
              },
              { name: 'Tart nenas', priceCents: 2_000, position: 1 },
            ],
          },
        },
      },
    },
    select: {
      pages: {
        select: {
          id: true,
          items: { orderBy: { position: 'asc' }, select: { id: true, options: { orderBy: { position: 'asc' }, select: { id: true } } } },
        },
      },
    },
  });
  const page = account.pages[0]!;
  const [cake, tart] = page.items;
  return {
    handle: slug,
    email,
    pageId: page.id,
    cakeId: cake!.id,
    cake1kg: cake!.options[0]!.id,
    cake2kg: cake!.options[1]!.id,
    tartId: tart!.id,
  };
}

type Shop = Awaited<ReturnType<typeof aShop>>;

/** The first day the shop takes, by the same rule the server applies. */
const firstDay = (minNoticeDays = 1, closedDays: number[] = []) =>
  openDays({ now: new Date(), minNoticeDays, closedDays }, 1)[0]!;

/** One 2kg cake and two trays of tart, picked up: RM170 + RM40. */
function aBasket(shop: Shop, over: Record<string, unknown> = {}) {
  return {
    lines: [
      { itemId: shop.cakeId, optionId: shop.cake2kg, quantity: 1 },
      { itemId: shop.tartId, optionId: null, quantity: 2 },
    ],
    method: 'PICKUP',
    day: firstDay(),
    customerName: 'Aisyah',
    phone: '012-345 6789',
    address: null,
    note: 'Tulis “Selamat Hari Jadi Mak” please',
    consent: true,
    seenTotalCents: 21_000,
    ...over,
  };
}

const place = (handle: string, payload: object, remoteAddress = from()) =>
  app.inject({ method: 'POST', url: `/store/${handle}/orders`, remoteAddress, payload });

const ordersPlaced = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { ordersPlaced: true } })).ordersPlaced;

describe('POST /store/:handle/orders', () => {
  it('places an order and fixes its total on the server', async () => {
    const shop = await aShop();

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ number: 1, code: expect.stringMatching(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/), token: expect.any(String), totalCents: 21_000 });
    // 32 bytes, base64url.
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const order = await app.prisma.order.findFirstOrThrow({ where: { pageId: shop.pageId } });
    expect(order).toMatchObject({
      number: 1,
      code: body.code,
      tokenHash: hashSessionValue(body.token),
      customerName: 'Aisyah',
      phone: '+60123456789',
      method: 'PICKUP',
      address: null,
      note: 'Tulis “Selamat Hari Jadi Mak” please',
      itemsCents: 21_000,
      deliveryCents: 0,
      totalCents: 21_000,
      status: 'PLACED',
    });
    expect(order.day.toISOString().slice(0, 10)).toBe(firstDay());
    expect(await ordersPlaced(shop.pageId)).toBe(1);
  });

  it('adds a flat delivery fee and keeps the address', async () => {
    const shop = await aShop({ deliveryMode: 'FLAT', deliveryFeeCents: 1_000 });

    const res = await place(shop.handle, aBasket(shop, { method: 'DELIVERY', address: '12 Jalan Mawar, Shah Alam', seenTotalCents: 22_000 }));

    expect(res.statusCode).toBe(201);
    expect(res.json().totalCents).toBe(22_000);
    const order = await app.prisma.order.findFirstOrThrow({ where: { pageId: shop.pageId } });
    expect(order).toMatchObject({ method: 'DELIVERY', address: '12 Jalan Mawar, Shah Alam', itemsCents: 21_000, deliveryCents: 1_000, totalCents: 22_000 });
  });

  it('copies each line, so a later price change rewrites nothing', async () => {
    const shop = await aShop();
    expect((await place(shop.handle, aBasket(shop))).statusCode).toBe(201);

    await app.prisma.itemOption.update({ where: { id: shop.cake2kg }, data: { label: '2 kilo', priceCents: 19_000 } });
    await app.prisma.item.update({ where: { id: shop.tartId }, data: { name: 'Tart nanas', priceCents: 2_500 } });

    const order = await app.prisma.order.findFirstOrThrow({
      where: { pageId: shop.pageId },
      select: { totalCents: true, lines: { orderBy: { position: 'asc' }, select: { itemId: true, itemName: true, optionLabel: true, unitPriceCents: true, quantity: true, position: true } } },
    });
    expect(order.totalCents).toBe(21_000);
    expect(order.lines).toEqual([
      { itemId: shop.cakeId, itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17_000, quantity: 1, position: 0 },
      { itemId: shop.tartId, itemName: 'Tart nenas', optionLabel: null, unitPriceCents: 2_000, quantity: 2, position: 1 },
    ]);
  });

  it('numbers orders per page, 1 then 2', async () => {
    const shop = await aShop();
    const other = await aShop();

    const first = await place(shop.handle, aBasket(shop));
    const elsewhere = await place(other.handle, aBasket(other));
    const second = await place(shop.handle, aBasket(shop));

    expect(first.json().number).toBe(1);
    expect(elsewhere.json().number).toBe(1);
    expect(second.json().number).toBe(2);
    expect(second.json().token).not.toBe(first.json().token);
    expect(await ordersPlaced(shop.pageId)).toBe(2);
  });

  it('refuses a total the visitor did not see, returning the shelf', async () => {
    const shop = await aShop();

    const res = await place(shop.handle, aBasket(shop, { seenTotalCents: 20_000 }));

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toEqual({
      code: 'PRICES_CHANGED',
      message: 'Prices changed since you opened the shop. Check your basket and try again.',
    });
    // getPublicShop's item shape, so the basket can reload from it.
    expect(body.items).toEqual([
      {
        id: shop.cakeId,
        name: 'Kek coklat moist',
        description: null,
        photoKey: null,
        priceCents: null,
        options: [
          { id: shop.cake1kg, label: '1kg', priceCents: 9_500 },
          { id: shop.cake2kg, label: '2kg', priceCents: 17_000 },
        ],
      },
      { id: shop.tartId, name: 'Tart nenas', description: null, photoKey: null, priceCents: 2_000, options: [] },
    ]);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
    expect(await ordersPlaced(shop.pageId)).toBe(0);
  });

  it('refuses an item taken down, naming it', async () => {
    const shop = await aShop();
    await app.prisma.item.update({ where: { id: shop.tartId }, data: { available: false } });

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ITEM_UNAVAILABLE', message: 'Tart nenas isn\'t available any more.' });
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses an item from another shop without naming it', async () => {
    const shop = await aShop();
    const other = await aShop();

    const res = await place(shop.handle, aBasket(shop, { lines: [{ itemId: other.tartId, optionId: null, quantity: 1 }], seenTotalCents: 2_000 }));

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ITEM_UNAVAILABLE');
    expect(res.json().error.message).not.toContain('Tart nenas');
  });

  it('refuses an option that is not the item\'s own', async () => {
    const shop = await aShop();
    const other = await aShop();

    for (const line of [
      // Another shop's option on this shop's cake.
      { itemId: shop.cakeId, optionId: other.cake2kg, quantity: 1 },
      // No option on an item that has options.
      { itemId: shop.cakeId, optionId: null, quantity: 1 },
      // An option on an item that has none.
      { itemId: shop.tartId, optionId: shop.cake2kg, quantity: 1 },
    ]) {
      const res = await place(shop.handle, aBasket(shop, { lines: [line], seenTotalCents: 17_000 }));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ITEM_UNAVAILABLE');
    }
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses a closed day, a day inside the notice, and delivery while delivery is off', async () => {
    const day = firstDay(3);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

    const closed = await aShop({ closedDays: [weekday], minNoticeDays: 3 });
    const onClosed = await place(closed.handle, aBasket(closed, { day }));
    expect(onClosed.statusCode).toBe(400);
    expect(onClosed.json().error).toEqual({ code: 'ORDER_DATE', message: 'Pick one of the days shown.' });

    const notice = await aShop({ minNoticeDays: 3 });
    const tooSoon = await place(notice.handle, aBasket(notice, { day: malaysiaToday(new Date()) }));
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.json().error.code).toBe('ORDER_DATE');

    const noDelivery = await aShop({ deliveryMode: 'NONE', deliveryFeeCents: null });
    const delivered = await place(noDelivery.handle, aBasket(noDelivery, { method: 'DELIVERY', address: '12 Jalan Mawar' }));
    expect(delivered.statusCode).toBe(400);
    expect(delivered.json().error).toEqual({ code: 'METHOD_OFF', message: 'Delivery isn\'t offered right now.' });

    const noPickup = await aShop({ pickupEnabled: false });
    const pickedUp = await place(noPickup.handle, aBasket(noPickup));
    expect(pickedUp.statusCode).toBe(400);
    expect(pickedUp.json().error).toEqual({ code: 'METHOD_OFF', message: 'Pickup isn\'t offered right now.' });

    for (const shop of [closed, notice, noDelivery, noPickup]) {
      expect(await ordersPlaced(shop.pageId)).toBe(0);
    }
  });

  it('refuses delivery without an address', async () => {
    const shop = await aShop();

    for (const address of [null, '   ']) {
      const res = await place(shop.handle, aBasket(shop, { method: 'DELIVERY', address, seenTotalCents: 22_000 }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual({ code: 'ADDRESS_REQUIRED', message: 'Add the address for delivery.' });
    }
  });

  it('refuses a phone number that is not a Malaysian mobile', async () => {
    const shop = await aShop();

    const res = await place(shop.handle, aBasket(shop, { phone: '03-1234 5678' }));

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PHONE');
  });

  it('refuses without consent', async () => {
    const shop = await aShop();

    const res = await place(shop.handle, aBasket(shop, { consent: false }));

    expect(res.statusCode).toBe(400);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses an order too big for one total', async () => {
    const shop = await aShop();
    await app.prisma.item.update({ where: { id: shop.tartId }, data: { priceCents: 1_000_000 } });
    // 50 lines of 99 at RM10,000: RM49.5 million, past what an Int column holds.
    const lines = Array.from({ length: 50 }, () => ({ itemId: shop.tartId, optionId: null, quantity: 99 }));

    const res = await place(shop.handle, aBasket(shop, { lines, seenTotalCents: 4_950_000_000 }));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'ORDER_TOO_LARGE',
      message: 'This order is too big to place here. Send it to the shop on WhatsApp instead.',
    });
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
    expect(await ordersPlaced(shop.pageId)).toBe(0);
  });

  it('refuses a page unpublished after the visitor opened it', async () => {
    const shop = await aShop();
    await app.prisma.page.update({ where: { id: shop.pageId }, data: { published: false } });

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAGE_NOT_FOUND');
  });

  it('refuses a personal page', async () => {
    const shop = await aShop({ mode: 'PERSONAL' });

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('STORE_BUSINESS_ONLY');
  });

  it('refuses a shop that is switched off, and a page that is not there', async () => {
    const shop = await aShop({ storeEnabled: false });

    const closed = await place(shop.handle, aBasket(shop));
    expect(closed.statusCode).toBe(404);
    expect(closed.json().error.code).toBe('STORE_CLOSED');

    const missing = await place('no-such-shop-zzz', aBasket(shop));
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PAGE_NOT_FOUND');
  });

  it('refuses once the free orders are used and nothing is paid', async () => {
    const shop = await aShop({ ordersPlaced: 3 });

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'ORDERS_PAUSED',
      message: 'This shop isn\'t taking orders right now. Send your basket on WhatsApp instead.',
    });
    expect(await ordersPlaced(shop.pageId)).toBe(3);
  });

  it('places one of two simultaneous last orders', async () => {
    const shop = await aShop({ ordersPlaced: 2 });

    const results = await Promise.all([place(shop.handle, aBasket(shop)), place(shop.handle, aBasket(shop))]);

    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const refused = results.find((res) => res.statusCode === 409)!;
    expect(refused.json().error.code).toBe('ORDERS_PAUSED');
    const placed = results.find((res) => res.statusCode === 201)!;
    expect(placed.json().number).toBe(3);
    expect(await ordersPlaced(shop.pageId)).toBe(3);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(1);
  });

  it('emails the owner, unless they switched it off', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, aBasket(shop));
    expect(res.statusCode).toBe(201);

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, data] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe(MAIL_QUEUE);
    const order = await app.prisma.order.findFirstOrThrow({ where: { pageId: shop.pageId }, select: { id: true } });
    expect(data.to).toBe(shop.email);
    expect(data.subject).toBe('New order #1 · RM210');
    expect(data.html).toContain(`/app/orders?order=${order.id}`);
    expect(data.html).toContain('Aisyah ordered RM210 from your shop');

    mailQueue.add.mockClear();
    const quiet = await aShop({ notifyOrders: false });
    expect((await place(quiet.handle, aBasket(quiet))).statusCode).toBe(201);
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('keeps the order when the email cannot be queued', async () => {
    const shop = await aShop();
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(201);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(1);
  });

  it('answers without waiting on the email queue', async () => {
    const shop = await aShop();
    // A Redis reconnect: the add never settles.
    mailQueue.add.mockImplementationOnce(() => new Promise(() => {}));

    const res = await place(shop.handle, aBasket(shop));

    expect(res.statusCode).toBe(201);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  }, 3_000);

  it('limits placements per address', async () => {
    // A handle with no page: each request still spends a token, and nothing is written.
    const address = '198.51.100.77';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await place(`no-such-shop-${randomUUID().slice(0, 8)}`, { consent: true }, address)).statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('limits placements per shop, from every address and in any casing', async () => {
    // The budget is read when the app is built, so a second app with a small one.
    const original = process.env.RATE_LIMIT_ORDER_PER_PAGE;
    process.env.RATE_LIMIT_ORDER_PER_PAGE = '3';
    const tight = await buildApp({ orders: { mailQueue } });
    await tight.ready();
    try {
      const handle = `no-such-shop-${randomUUID().slice(0, 8)}`;
      const statuses: number[] = [];
      for (const [i, spelling] of [handle, handle.toUpperCase(), handle, handle.toUpperCase()].entries()) {
        const res = await tight.inject({ method: 'POST', url: `/store/${spelling}/orders`, remoteAddress: `198.51.100.${10 + i}`, payload: { consent: true } });
        statuses.push(res.statusCode);
      }
      expect(statuses.slice(0, 3).every((status) => status !== 429)).toBe(true);
      expect(statuses[3]).toBe(429);
    } finally {
      await tight.close();
      if (original === undefined) delete process.env.RATE_LIMIT_ORDER_PER_PAGE;
      else process.env.RATE_LIMIT_ORDER_PER_PAGE = original;
    }
  });
});

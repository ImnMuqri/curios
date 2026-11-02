import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.119.${(nth++ % 200) + 1}`;
const accountIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  // Pages, places, windows and orders go with the account.
  await app.prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await app.close();
});

/** A pickup shop with a stall (10am–12pm for two a day, 2pm–4pm with no limit) and an any-time home. */
async function aShop() {
  const handle = `pt-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `pt-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          published: true,
          mode: 'BUSINESS',
          storeEnabled: true,
          pickupEnabled: true,
          minNoticeDays: 1,
          pickupPlaces: {
            create: [
              {
                name: 'Stall',
                address: 'Pasar Tani, Seksyen 7',
                anyTime: false,
                position: 0,
                windows: {
                  create: [
                    { fromMinute: 600, toMinute: 720, limit: 2, position: 0 },
                    { fromMinute: 840, toMinute: 960, limit: null, position: 1 },
                  ],
                },
              },
              { name: 'Home', address: '12 Jalan Mawar', anyTime: true, position: 1 },
            ],
          },
        },
      },
    },
    select: {
      id: true,
      pages: { select: { id: true, pickupPlaces: { orderBy: { position: 'asc' }, select: { id: true, windows: { orderBy: { position: 'asc' }, select: { id: true } } } } } },
    },
  });
  accountIds.push(account.id);
  const page = account.pages[0]!;
  const [stall, home] = page.pickupPlaces;
  return { handle, pageId: page.id, stall: stall!.id, home: home!.id, capped: stall!.windows[0]!.id, open: stall!.windows[1]!.id };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const [dayOne, dayTwo] = openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 2) as [string, string];

let code = 0;
/** An order straight into the table: what counts is its window, day and status. */
const anOrder = (shop: Shop, windowId: string, onDay: string, status: 'PLACED' | 'PAID' | 'CANCELLED' = 'PLACED') =>
  app.prisma.order.create({
    data: {
      pageId: shop.pageId,
      number: ++code,
      code: `T${String(code).padStart(3, '0')}`.slice(-4),
      tokenHash: randomUUID(),
      customerName: 'Aisyah',
      phone: '+60123456789',
      method: 'PICKUP',
      day: new Date(`${onDay}T00:00:00Z`),
      itemsCents: 2_000,
      deliveryCents: 0,
      totalCents: 2_000,
      status,
      pickupPlaceId: shop.stall,
      pickupWindowId: windowId,
    },
  });

const times = (handle: string, query: string) => app.inject({ method: 'GET', url: `/store/${handle}/pickup-times?${query}`, remoteAddress: from() });

describe('GET /store/:handle/pickup-times', () => {
  it('a window is full once its non-cancelled orders on that day reach the limit; one with no limit never is', async () => {
    const shop = await aShop();
    const ask = async () => (await times(shop.handle, `place=${shop.stall}&day=${dayOne}`)).json();
    expect(await ask()).toEqual({
      windows: [
        { id: shop.capped, from: 600, to: 720, full: false },
        { id: shop.open, from: 840, to: 960, full: false },
      ],
    });

    await anOrder(shop, shop.capped, dayOne, 'PAID');
    await anOrder(shop, shop.capped, dayOne, 'CANCELLED');
    // Another day's order takes nothing from this one.
    await anOrder(shop, shop.capped, dayTwo);
    for (let i = 0; i < 3; i++) await anOrder(shop, shop.open, dayOne);
    expect((await ask()).windows.map((w: { full: boolean }) => w.full)).toEqual([false, false]);

    await anOrder(shop, shop.capped, dayOne);
    expect((await ask()).windows.map((w: { full: boolean }) => w.full)).toEqual([true, false]);
    // The next day still has room.
    const next = await times(shop.handle, `place=${shop.stall}&day=${dayTwo}`);
    expect(next.json().windows.map((w: { full: boolean }) => w.full)).toEqual([false, false]);
  });

  it('an any-time place has no windows', async () => {
    const shop = await aShop();
    const res = await times(shop.handle, `place=${shop.home}&day=${dayOne}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ windows: [] });
  });

  it('refuses a day the shop does not take, and a place that is not its own', async () => {
    const shop = await aShop();
    const other = await aShop();
    const badDay = await times(shop.handle, `place=${shop.stall}&day=2020-01-01`);
    expect(badDay.statusCode).toBe(400);
    expect(badDay.json().error.code).toBe('ORDER_DATE');
    const theirs = await times(shop.handle, `place=${other.stall}&day=${dayOne}`);
    expect(theirs.statusCode).toBe(400);
    expect(theirs.json().error.code).toBe('PICKUP_PLACE_REQUIRED');
    expect((await times('no-such-shop-here', `place=${shop.stall}&day=${dayOne}`)).statusCode).toBe(404);
  });
});

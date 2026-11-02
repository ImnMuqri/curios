import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashSessionValue, type MailJobData } from '@curios/core';
import { openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';
import { placeOrder, type PlaceInput } from './place.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.118.${(nth++ % 200) + 1}`;
const accountIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ orders: { mailQueue } });
  await app.ready();
});
afterAll(async () => {
  // Pages, places, windows and orders go with the account.
  await app.prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await app.close();
});

type WindowData = { from: number; to: number; limit: number | null };
type PlaceData = { name: string; address: string; anyTime: boolean; windows?: WindowData[] };

/** A business shop with pickup and flat delivery, a RM20 tart, and the pickup places given. */
async function aShop(places: PlaceData[] = []) {
  const handle = `ps-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `ps-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          published: true,
          mode: 'BUSINESS',
          storeEnabled: true,
          pickupEnabled: true,
          deliveryMode: 'FLAT',
          deliveryFeeCents: 1_000,
          minNoticeDays: 1,
          items: { create: [{ name: 'Tart nenas', slug: 'tart', priceCents: 2_000, position: 0 }] },
          pickupPlaces: {
            create: places.map((p, position) => ({
              name: p.name,
              address: p.address,
              anyTime: p.anyTime,
              position,
              windows: { create: (p.windows ?? []).map((w, i) => ({ fromMinute: w.from, toMinute: w.to, limit: w.limit, position: i })) },
            })),
          },
        },
      },
    },
    select: {
      id: true,
      pages: {
        select: {
          id: true,
          items: { select: { id: true } },
          pickupPlaces: { orderBy: { position: 'asc' }, select: { id: true, windows: { orderBy: { position: 'asc' }, select: { id: true } } } },
        },
      },
    },
  });
  accountIds.push(account.id);
  const page = account.pages[0]!;
  return {
    handle,
    pageId: page.id,
    tart: page.items[0]!.id,
    places: page.pickupPlaces.map((p) => ({ id: p.id, windows: p.windows.map((w) => w.id) })),
  };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const STALL: PlaceData = { name: 'Stall', address: 'Pasar Tani, Seksyen 7', anyTime: false, windows: [{ from: 600, to: 720, limit: null }, { from: 840, to: 960, limit: 1 }] };
const HOME: PlaceData = { name: 'Home', address: '12 Jalan Mawar', anyTime: true };

const day = () => openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 1)[0]!;

/** Two trays of tart: RM40 picked up, RM50 delivered. */
const basket = (shop: Shop, over: Partial<PlaceInput> = {}): PlaceInput => ({
  handle: shop.handle,
  lines: [{ itemId: shop.tart, optionId: null, quantity: 2 }],
  method: 'PICKUP',
  day: day(),
  customerName: 'Aisyah',
  phone: '012-345 6789',
  address: null,
  note: null,
  seenTotalCents: 4_000,
  ...over,
});

const deps = async () => ({
  prisma: app.prisma,
  mailQueue,
  appUrl: 'https://curios.example',
  apiUrl: 'https://api.curios.example',
  secretsKey: null,
  settings: await app.settings.get(),
});
const placeNow = async (input: PlaceInput) => placeOrder(await deps(), input, new Date());
const orderOf = (token: string) => app.prisma.order.findUniqueOrThrow({ where: { tokenHash: hashSessionValue(token) } });
const placeRoute = (handle: string, payload: object) =>
  app.inject({ method: 'POST', url: `/store/${handle}/orders`, remoteAddress: from(), payload: { consent: true, ...payload } });
const body = (input: PlaceInput) => ({ ...input, handle: undefined });

describe('placing a pickup order at a place and time', () => {
  it('a shop with places needs one of its own places', async () => {
    const shop = await aShop([HOME]);
    const other = await aShop([HOME]);
    for (const pickupPlaceId of [undefined, null, other.places[0]!.id]) {
      const res = await placeRoute(shop.handle, body(basket(shop, { pickupPlaceId })));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: { code: 'PICKUP_PLACE_REQUIRED', message: 'Pick where to collect it.' } });
    }
  });

  it('a place with set times needs one of its windows', async () => {
    const shop = await aShop([STALL]);
    const res = await placeRoute(shop.handle, body(basket(shop, { pickupPlaceId: shop.places[0]!.id })));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'PICKUP_TIME_REQUIRED', message: 'Pick a pickup time.' } });
  });

  it('the order keeps the place and the time as they were when it was placed', async () => {
    const shop = await aShop([STALL]);
    const stall = shop.places[0]!;
    const res = await placeRoute(shop.handle, body(basket(shop, { pickupPlaceId: stall.id, pickupWindowId: stall.windows[0]! })));
    expect(res.statusCode).toBe(201);
    expect(await orderOf(res.json().token)).toMatchObject({
      method: 'PICKUP',
      pickupPlaceId: stall.id,
      pickupPlaceName: 'Stall',
      pickupPlaceAddress: 'Pasar Tani, Seksyen 7',
      pickupWindowId: stall.windows[0],
      pickupFrom: 600,
      pickupTo: 720,
    });
    // The owner's new-order email says where and when.
    const mail = mailQueue.add.mock.calls.at(-1)![1];
    expect(mail.text).toMatch(/Getting it: Pickup · \w{3} \d{1,2} \w{3}, 10am–12pm · Stall\n/);
  });

  it('an any-time place takes no window, and one sent is ignored', async () => {
    const shop = await aShop([HOME, STALL]);
    const [home, stall] = shop.places;
    const without = await placeNow(basket(shop, { pickupPlaceId: home!.id }));
    expect(await orderOf(without.token)).toMatchObject({ pickupPlaceName: 'Home', pickupPlaceAddress: '12 Jalan Mawar', pickupWindowId: null, pickupFrom: null, pickupTo: null });
    const sent = await placeNow(basket(shop, { pickupPlaceId: home!.id, pickupWindowId: stall!.windows[0]! }));
    expect(await orderOf(sent.token)).toMatchObject({ pickupPlaceId: home!.id, pickupWindowId: null, pickupFrom: null, pickupTo: null });
  });

  it("another place's window, or one that is gone, is not offered", async () => {
    const shop = await aShop([STALL, { ...STALL, name: 'Kiosk' }]);
    const [stall, kiosk] = shop.places;
    for (const pickupWindowId of [kiosk!.windows[0]!, 'no-such-window']) {
      const res = await placeRoute(shop.handle, body(basket(shop, { pickupPlaceId: stall!.id, pickupWindowId })));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: { code: 'PICKUP_TIME_GONE', message: "That pickup time isn't offered any more. Pick another." } });
    }
  });

  it('two customers on the last spot of a capped window at once: one gets it, the other is told it filled', async () => {
    const shop = await aShop([STALL]);
    const stall = shop.places[0]!;
    const input = basket(shop, { pickupPlaceId: stall.id, pickupWindowId: stall.windows[1]! });
    const results = await Promise.allSettled([placeNow(input), placeNow(input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      code: 'PICKUP_TIME_FULL',
      message: 'That pickup time just filled up. Pick another.',
    });
    expect(await app.prisma.order.count({ where: { pickupWindowId: stall.windows[1]! } })).toBe(1);
  });

  it('a cancelled order gives its spot back, and a full window on one day is open on another', async () => {
    const shop = await aShop([STALL]);
    const stall = shop.places[0]!;
    const input = basket(shop, { pickupPlaceId: stall.id, pickupWindowId: stall.windows[1]! });
    const first = await placeNow(input);
    const res = await placeRoute(shop.handle, body(input));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PICKUP_TIME_FULL');

    const nextDay = openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 2)[1]!;
    await expect(placeNow({ ...input, day: nextDay })).resolves.toMatchObject({ totalCents: 4_000 });

    await app.prisma.order.update({ where: { tokenHash: hashSessionValue(first.token) }, data: { status: 'CANCELLED' } });
    await expect(placeNow(input)).resolves.toMatchObject({ totalCents: 4_000 });
  });

  it('a delivery order ignores the pickup fields', async () => {
    const shop = await aShop([STALL]);
    const stall = shop.places[0]!;
    const placed = await placeNow(
      basket(shop, { method: 'DELIVERY', address: '3 Jalan Kenanga', seenTotalCents: 5_000, pickupPlaceId: stall.id, pickupWindowId: stall.windows[1]! }),
    );
    expect(await orderOf(placed.token)).toMatchObject({
      method: 'DELIVERY',
      pickupPlaceId: null,
      pickupPlaceName: null,
      pickupPlaceAddress: null,
      pickupWindowId: null,
      pickupFrom: null,
      pickupTo: null,
    });
  });

  it('a shop with pickup on and no places yet (data from before places) takes pickup as any time, with no place', async () => {
    const shop = await aShop([]);
    const placed = await placeNow(basket(shop));
    expect(await orderOf(placed.token)).toMatchObject({ method: 'PICKUP', pickupPlaceId: null, pickupPlaceName: null, pickupWindowId: null });
  });
});

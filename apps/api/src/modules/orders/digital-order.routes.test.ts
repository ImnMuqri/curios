import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MailJobData } from '@curios/core';
import { openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };
const store: AvatarStore = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.116.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ orders: { mailQueue, store } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const DAY = 24 * 3_600_000;

/** A shop with a cake (physical) and one of each digital kind: 1 file, 1 link, 1 code, 1 class time with 1 seat. */
async function aShop() {
  const slug = `dg-${randomUUID().slice(0, 8)}`;
  const email = `dg-${randomUUID()}@example.com`;
  const account = await app.prisma.account.create({
    data: {
      email,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Kek Lina',
          published: true,
          mode: 'BUSINESS',
          storeEnabled: true,
          pickupEnabled: true,
          deliveryMode: 'FLAT',
          deliveryFeeCents: 1_000,
          minNoticeDays: 1,
          items: {
            create: [
              { name: 'Kek', slug: 'kek', priceCents: 5_000, position: 0 },
              { name: 'Recipe e-book', slug: 'ebook', priceCents: 2_500, position: 1, kind: 'DIGITAL', delivery: 'FILES', files: { create: { key: `k/${slug}/a`, name: 'recipe.pdf', sizeBytes: 10, contentType: 'application/pdf', position: 0 } } },
              { name: 'Video course', slug: 'course', priceCents: 7_900, position: 2, kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/course', accessNote: 'Start with video one' },
              { name: 'Gift voucher', slug: 'voucher', priceCents: 5_000, position: 3, kind: 'DIGITAL', delivery: 'CODES', codes: { create: [{ code: 'ONLY-ONE' }] } },
              {
                name: 'Online class',
                slug: 'class',
                priceCents: 6_000,
                position: 4,
                kind: 'DIGITAL',
                delivery: 'SESSION',
                sessionMinutes: 90,
                sessionPlace: 'ONLINE',
                sessionWhere: 'https://meet.example.com/abc',
                sessions: { create: [{ startsAt: new Date(Date.now() + 7 * DAY), seats: 1 }] },
              },
              { name: 'Empty e-book', slug: 'empty', priceCents: 1_000, position: 5, kind: 'DIGITAL', delivery: 'FILES' },
            ],
          },
        },
      },
    },
    select: { pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true, sessions: { select: { id: true } } } } } } },
  });
  const page = account.pages[0]!;
  const [cake, ebook, course, voucher, cls, empty] = page.items;
  return {
    handle: slug,
    email,
    pageId: page.id,
    cake: cake!.id,
    ebook: ebook!.id,
    course: course!.id,
    voucher: voucher!.id,
    cls: cls!.id,
    time: cls!.sessions[0]!.id,
    empty: empty!.id,
  };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const day = () => openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 1)[0]!;
const buyer = { customerName: 'Mira', phone: '012-345 6789', address: null, note: null, consent: true };
const place = (handle: string, payload: object) => app.inject({ method: 'POST', url: `/store/${handle}/orders`, remoteAddress: from(), payload });
const digital = (lines: object[], total: number, over: Record<string, unknown> = {}) => ({ ...buyer, lines, email: 'mira@example.com', seenTotalCents: total, ...over });
const line = (itemId: string, over: Record<string, unknown> = {}) => ({ itemId, optionId: null, quantity: 1, ...over });
const orderOf = async (token: string) => {
  const { hashSessionValue } = await import('@curios/core');
  return app.prisma.order.findUniqueOrThrow({ where: { tokenHash: hashSessionValue(token) }, include: { lines: { orderBy: { position: 'asc' } } } });
};

describe('placing a digital order', () => {
  it('places a digital-only order with no method and no day, and keeps the email', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, digital([line(shop.ebook), line(shop.course)], 10_400));
    expect(res.statusCode).toBe(201);
    const order = await orderOf(res.json().token);
    expect(order.method).toBeNull();
    expect(order.day).toBeNull();
    expect(order.email).toBe('mira@example.com');
    expect(order.deliveryCents).toBe(0);
    expect(order.totalCents).toBe(10_400);
  });

  it('snapshots what was sold on the line, and the owner may edit the item afterwards', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, digital([line(shop.course), line(shop.cls, { sessionId: shop.time })], 13_900));
    expect(res.statusCode).toBe(201);
    await app.prisma.item.update({ where: { id: shop.course }, data: { accessUrl: 'https://example.com/changed' } });
    const order = await orderOf(res.json().token);
    expect(order.lines[0]).toMatchObject({ kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/course', accessNote: 'Start with video one', sessionWhere: null });
    expect(order.lines[1]).toMatchObject({ delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'https://meet.example.com/abc', accessUrl: null });
  });

  it('refuses a digital order without an email, or with a bad one', async () => {
    const shop = await aShop();
    for (const email of [null, '', 'not-an-email']) {
      const res = await place(shop.handle, digital([line(shop.ebook)], 2_500, { email }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('EMAIL_REQUIRED');
    }
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);
  });

  it('refuses a method or a day on a digital-only order', async () => {
    const shop = await aShop();
    const withMethod = await place(shop.handle, digital([line(shop.ebook)], 2_500, { method: 'PICKUP' }));
    expect(withMethod.json().error.code).toBe('INVALID_ORDER');
    const withDay = await place(shop.handle, digital([line(shop.ebook)], 2_500, { day: day() }));
    expect(withDay.json().error.code).toBe('INVALID_ORDER');
  });

  it('keeps method and day required once there is a physical line', async () => {
    const shop = await aShop();
    const lines = [line(shop.cake), line(shop.ebook)];
    const noDay = await place(shop.handle, digital(lines, 7_500, { method: 'PICKUP' }));
    expect(noDay.statusCode).toBe(400);
    expect(noDay.json().error.code).toBe('ORDER_DATE');
    const noMethod = await place(shop.handle, digital(lines, 7_500, { day: day() }));
    expect(noMethod.statusCode).toBe(400);
    expect(noMethod.json().error.code).toBe('INVALID_ORDER');
    const ok = await place(shop.handle, digital(lines, 7_500, { method: 'PICKUP', day: day() }));
    expect(ok.statusCode).toBe(201);
    const order = await orderOf(ok.json().token);
    expect(order.method).toBe('PICKUP');
    expect(order.email).toBe('mira@example.com');
  });

  it('charges delivery on a mixed order only for its physical part, and none on a digital one', async () => {
    const shop = await aShop();
    const mixed = await place(shop.handle, digital([line(shop.cake), line(shop.ebook)], 8_500, { method: 'DELIVERY', address: '1 Jalan', day: day() }));
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json().totalCents).toBe(8_500);
  });

  it('refuses a physical-only order with no method and day, as before', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, { ...buyer, lines: [line(shop.cake)], seenTotalCents: 5_000 });
    expect(res.statusCode).toBe(400);
  });

  it('says sold out for a file item with no file, and for a link with none', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, digital([line(shop.empty)], 1_000));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOLD_OUT');
    await app.prisma.item.update({ where: { id: shop.course }, data: { accessUrl: null } });
    expect((await place(shop.handle, digital([line(shop.course)], 7_900))).json().error.code).toBe('SOLD_OUT');
  });

  it('gives each buyer a different code, and the last code to one buyer only', async () => {
    const shop = await aShop();
    const results = await Promise.all([place(shop.handle, digital([line(shop.voucher)], 5_000)), place(shop.handle, digital([line(shop.voucher)], 5_000))]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe('SOLD_OUT');
    const code = await app.prisma.itemCode.findFirstOrThrow({ where: { itemId: shop.voucher } });
    expect(code.orderLineId).not.toBeNull();
    // The loser left nothing behind.
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(1);
  });

  it('refuses a quantity above the codes left, taking none', async () => {
    const shop = await aShop();
    await app.prisma.itemCode.create({ data: { itemId: shop.voucher, code: 'TWO' } });
    const res = await place(shop.handle, digital([line(shop.voucher, { quantity: 3 })], 15_000));
    expect(res.json().error.code).toBe('SOLD_OUT');
    expect(await app.prisma.itemCode.count({ where: { itemId: shop.voucher, orderLineId: null } })).toBe(2);
    const two = await place(shop.handle, digital([line(shop.voucher, { quantity: 2 })], 10_000));
    expect(two.statusCode).toBe(201);
    expect(await app.prisma.itemCode.count({ where: { itemId: shop.voucher, orderLineId: null } })).toBe(0);
  });

  it('books the last seat for one buyer only', async () => {
    const shop = await aShop();
    const body = () => digital([line(shop.cls, { sessionId: shop.time })], 6_000);
    const results = await Promise.all([place(shop.handle, body()), place(shop.handle, body())]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe('TIME_FULL');
    const bookings = await app.prisma.sessionBooking.findMany({ where: { sessionId: shop.time } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.seats).toBe(1);
  });

  it('refuses a class with no time, a time of another item, and a past time', async () => {
    const shop = await aShop();
    expect((await place(shop.handle, digital([line(shop.cls)], 6_000))).json().error.code).toBe('TIME_REQUIRED');
    expect((await place(shop.handle, digital([line(shop.ebook, { sessionId: shop.time })], 2_500))).json().error.code).toBe('ITEM_UNAVAILABLE');
    const past = await app.prisma.itemSession.create({ data: { itemId: shop.cls, startsAt: new Date(Date.now() - DAY), seats: 5 } });
    expect((await place(shop.handle, digital([line(shop.cls, { sessionId: past.id })], 6_000))).json().error.code).toBe('TIME_FULL');
  });

  it('books quantity seats', async () => {
    const shop = await aShop();
    await app.prisma.itemSession.update({ where: { id: shop.time }, data: { seats: 3 } });
    expect((await place(shop.handle, digital([line(shop.cls, { sessionId: shop.time, quantity: 4 })], 24_000))).json().error.code).toBe('TIME_FULL');
    const ok = await place(shop.handle, digital([line(shop.cls, { sessionId: shop.time, quantity: 3 })], 18_000));
    expect(ok.statusCode).toBe(201);
    expect((await app.prisma.sessionBooking.findFirstOrThrow({ where: { sessionId: shop.time } })).seats).toBe(3);
  });

  it('hands back digital facts with PRICES_CHANGED, hiding the link, codes and meeting place', async () => {
    const shop = await aShop();
    const res = await place(shop.handle, digital([line(shop.ebook)], 1));
    expect(res.statusCode).toBe(409);
    const items = res.json().items as { id: string; soldOut: boolean; format: unknown; sessions: unknown[]; minutes: number | null }[];
    const byId = (id: string) => items.find((i) => i.id === id)!;
    expect(byId(shop.ebook).format).toEqual({ kinds: ['PDF'], count: 1 });
    expect(byId(shop.empty).soldOut).toBe(true);
    expect(byId(shop.cls).sessions).toHaveLength(1);
    expect(byId(shop.cls).minutes).toBe(90);
    expect(JSON.stringify(items)).not.toMatch(/meet\.example|ONLY-ONE|example\.com\/course/);
  });
});

describe('ending an unpaid order releases what it held', () => {
  const move = (cookie: string, id: string, action: string) =>
    app.inject({ method: 'POST', url: `/orders/${id}/${action}`, remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie } });
  async function ownerOf(shop: Shop) {
    const account = await app.prisma.account.findUniqueOrThrow({ where: { email: shop.email }, select: { id: true } });
    return (await createSession(app.prisma, account.id)).value;
  }
  const basket = (shop: Shop) => digital([line(shop.voucher), line(shop.cls, { sessionId: shop.time })], 11_000);

  it('gives two lines of the same codes item (different options) distinct codes', async () => {
    const shop = await aShop();
    const item = await app.prisma.item.create({
      data: {
        pageId: shop.pageId,
        name: 'Top-up',
        slug: 'topup',
        priceCents: 1_000,
        position: 9,
        kind: 'DIGITAL',
        delivery: 'CODES',
        options: { create: [{ label: 'RM10', priceCents: 1_000, position: 0 }, { label: 'RM20', priceCents: 2_000, position: 1 }] },
        codes: { create: [{ code: 'T-1' }, { code: 'T-2' }, { code: 'T-3' }] },
      },
      select: { id: true, options: { orderBy: { position: 'asc' }, select: { id: true } } },
    });
    const [small, large] = item.options;
    const res = await place(shop.handle, digital([line(item.id, { optionId: small!.id }), line(item.id, { optionId: large!.id })], 3_000));
    expect(res.statusCode).toBe(201);
    const order = await orderOf(res.json().token);
    expect(order.lines).toHaveLength(2);
    const held = await app.prisma.itemCode.findMany({ where: { itemId: item.id, orderLineId: { not: null } }, select: { code: true, orderLineId: true } });
    expect(held).toHaveLength(2);
    expect(new Set(held.map((h) => h.code)).size).toBe(2);
    expect(new Set(held.map((h) => h.orderLineId))).toEqual(new Set(order.lines.map((l) => l.id)));
    expect(await app.prisma.itemCode.count({ where: { itemId: item.id, orderLineId: null } })).toBe(1);
  });

  it('cancelling frees the code and the seat, so the next buyer gets them', async () => {
    const shop = await aShop();
    const first = await place(shop.handle, basket(shop));
    expect(first.statusCode).toBe(201);
    expect((await place(shop.handle, basket(shop))).statusCode).toBe(409);
    const order = await orderOf(first.json().token);
    expect((await move(await ownerOf(shop), order.id, 'cancel')).statusCode).toBe(204);
    expect(await app.prisma.itemCode.count({ where: { itemId: shop.voucher, orderLineId: null } })).toBe(1);
    expect(await app.prisma.sessionBooking.count({ where: { sessionId: shop.time } })).toBe(0);
    expect((await place(shop.handle, basket(shop))).statusCode).toBe(201);
  });

  it('cancelling a paid order keeps the code given and frees the seat', async () => {
    const shop = await aShop();
    const first = await place(shop.handle, basket(shop));
    const order = await orderOf(first.json().token);
    const cookie = await ownerOf(shop);
    expect((await move(cookie, order.id, 'paid')).statusCode).toBe(204);
    expect((await move(cookie, order.id, 'cancel')).statusCode).toBe(204);
    expect(await app.prisma.itemCode.count({ where: { itemId: shop.voucher, orderLineId: { not: null } } })).toBe(1);
    expect(await app.prisma.sessionBooking.count({ where: { sessionId: shop.time } })).toBe(0);
  });

  it('not received leaves the order placed and keeps what it holds', async () => {
    const shop = await aShop();
    const first = await place(shop.handle, basket(shop));
    const order = await orderOf(first.json().token);
    await app.prisma.order.update({ where: { id: order.id }, data: { receiptKey: 'r/x.jpg', receiptType: 'image/jpeg', receiptUploadedAt: new Date() } });
    expect((await move(await ownerOf(shop), order.id, 'not-received')).statusCode).toBe(204);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PLACED');
    expect(await app.prisma.sessionBooking.count({ where: { sessionId: shop.time } })).toBe(1);
  });
});

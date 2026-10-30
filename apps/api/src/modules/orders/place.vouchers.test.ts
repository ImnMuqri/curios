import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashSessionValue, type MailJobData } from '@curios/core';
import { openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';
import { PricesChangedError } from './order.errors.js';
import { placeOrder, type PlaceInput } from './place.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.117.${(nth++ % 200) + 1}`;

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

/** A business shop: a cake at RM170, tarts at RM20, and a video course (a link) at RM79. */
async function aShop(options: { ordersPlaced?: number } = {}) {
  const slug = `pv-${randomUUID().slice(0, 8)}`;
  const email = `pv-${randomUUID()}@example.com`;
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
          ordersPlaced: options.ordersPlaced ?? 0,
          notifyOrders: true,
          items: {
            create: [
              { name: 'Kek coklat moist', slug: 'kek', priceCents: 17_000, position: 0 },
              { name: 'Tart nenas', slug: 'tart', priceCents: 2_000, position: 1 },
              { name: 'Video course', slug: 'course', priceCents: 7_900, position: 2, kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/course' },
            ],
          },
        },
      },
    },
    select: { pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true } } } } },
  });
  const page = account.pages[0]!;
  const [cake, tart, course] = page.items;
  return { handle: slug, email, pageId: page.id, cake: cake!.id, tart: tart!.id, course: course!.id };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

type VoucherData = {
  mode: 'AUTO' | 'CODE';
  code?: string;
  name?: string;
  kind?: 'PERCENT' | 'AMOUNT';
  percent?: number;
  amountCents?: number;
  itemId?: string;
  minSpendCents?: number;
  endsAt?: Date;
  maxUses?: number;
  active?: boolean;
};
const aVoucher = (shop: Shop, v: VoucherData) =>
  app.prisma.shopVoucher.create({
    data: { pageId: shop.pageId, kind: 'PERCENT', ...v, code: v.code ?? null, name: v.name ?? null },
    select: { id: true },
  });

const day = () => openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 1)[0]!;

/** One cake and two trays of tart, picked up: RM210 before any voucher. */
const basket = (shop: Shop, seenTotalCents: number, over: Partial<PlaceInput> = {}): PlaceInput => ({
  handle: shop.handle,
  lines: [
    { itemId: shop.cake, optionId: null, quantity: 1 },
    { itemId: shop.tart, optionId: null, quantity: 2 },
  ],
  method: 'PICKUP',
  day: day(),
  customerName: 'Aisyah',
  phone: '012-345 6789',
  address: null,
  note: null,
  seenTotalCents,
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

describe('placing an order with a voucher', () => {
  it('a live automatic voucher comes off with no code, and the order keeps what it took', async () => {
    const shop = await aShop();
    const raya = await aVoucher(shop, { mode: 'AUTO', name: 'Raya promo', percent: 10 });
    // RM210 less 10% (RM21).
    const res = await placeRoute(shop.handle, { ...basket(shop, 18_900), handle: undefined });
    expect(res.statusCode).toBe(201);
    expect(res.json().totalCents).toBe(18_900);
    expect(await orderOf(res.json().token)).toMatchObject({
      itemsCents: 21_000,
      discountCents: 2_100,
      deliveryCents: 0,
      totalCents: 18_900,
      voucherId: raya.id,
      voucherLabel: 'Raya promo',
      status: 'PLACED',
      paidVia: null,
    });
  });

  it('a typed code that saves more replaces the automatic one; one that saves less does not', async () => {
    const shop = await aShop();
    const auto = await aVoucher(shop, { mode: 'AUTO', name: 'Raya promo', percent: 10 });
    const big = await aVoucher(shop, { mode: 'CODE', code: 'BIG50', kind: 'AMOUNT', amountCents: 5_000 });
    await aVoucher(shop, { mode: 'CODE', code: 'SMALL5', kind: 'AMOUNT', amountCents: 500 });

    // Typed as a customer might: spaces and lower case.
    const better = await placeNow(basket(shop, 16_000, { voucherCode: ' big50 ' }));
    expect(await orderOf(better.token)).toMatchObject({ discountCents: 5_000, totalCents: 16_000, voucherId: big.id, voucherLabel: 'BIG50' });

    const worse = await placeNow(basket(shop, 18_900, { voucherCode: 'SMALL5' }));
    expect(await orderOf(worse.token)).toMatchObject({ discountCents: 2_100, totalCents: 18_900, voucherId: auto.id, voucherLabel: 'Raya promo' });
  });

  it('a voucher switched off since the total was shown is PRICES_CHANGED, sent back with the live automatic vouchers', async () => {
    const shop = await aShop();
    const raya = await aVoucher(shop, { mode: 'AUTO', name: 'Raya promo', percent: 10 });
    const five = await aVoucher(shop, { mode: 'AUTO', name: 'RM5 off', kind: 'AMOUNT', amountCents: 500 });
    await aVoucher(shop, { mode: 'CODE', code: 'SECRET', percent: 50 });
    await app.prisma.shopVoucher.update({ where: { id: raya.id }, data: { active: false } });

    const res = await placeRoute(shop.handle, { ...basket(shop, 18_900), handle: undefined });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('PRICES_CHANGED');
    expect(body.vouchers).toEqual([
      { id: five.id, mode: 'AUTO', kind: 'AMOUNT', percent: null, amountCents: 500, itemId: null, minSpendCents: null, label: 'RM5 off' },
    ]);
    expect(body.items).toHaveLength(3);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(0);

    // With the total it now shows, it goes through with the voucher still on.
    const again = await placeRoute(shop.handle, { ...basket(shop, 20_500), handle: undefined });
    expect(again.statusCode).toBe(201);
    expect(await orderOf(again.json().token)).toMatchObject({ discountCents: 500, voucherId: five.id });
  });

  it('an ended voucher, or a used-up one, is left out', async () => {
    const shop = await aShop();
    await aVoucher(shop, { mode: 'AUTO', name: 'Ended', percent: 10, endsAt: new Date(Date.now() - 1000) });
    await aVoucher(shop, { mode: 'CODE', code: 'GONE', percent: 10, maxUses: 1 });
    await placeNow(basket(shop, 18_900, { voucherCode: 'GONE' }));

    await expect(placeNow(basket(shop, 18_900))).rejects.toBeInstanceOf(PricesChangedError);
    const error = await placeNow(basket(shop, 18_900, { voucherCode: 'GONE' })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PricesChangedError);
    expect((error as PricesChangedError).vouchers).toEqual([]);
    const plain = await placeNow(basket(shop, 21_000, { voucherCode: 'GONE' }));
    expect(await orderOf(plain.token)).toMatchObject({ discountCents: 0, voucherId: null, voucherLabel: null, totalCents: 21_000 });
  });

  it('a cap of 1 and two customers at once with the same code: one gets it, the other is told prices changed', async () => {
    const shop = await aShop();
    const once = await aVoucher(shop, { mode: 'CODE', code: 'ONCE', percent: 50, maxUses: 1 });

    const results = await Promise.allSettled([
      placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' })),
      placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(PricesChangedError);
    expect(await app.prisma.order.count({ where: { pageId: shop.pageId } })).toBe(1);
    expect(await app.prisma.order.count({ where: { voucherId: once.id } })).toBe(1);
  });

  it('an order cancelled before it was paid gives its use back; one cancelled after paying does not', async () => {
    const shop = await aShop();
    const once = await aVoucher(shop, { mode: 'CODE', code: 'ONCE', percent: 50, maxUses: 1 });
    const first = await placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' }));
    await expect(placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' }))).rejects.toBeInstanceOf(PricesChangedError);

    await app.prisma.order.update({ where: { tokenHash: hashSessionValue(first.token) }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const second = await placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' }));
    expect(await orderOf(second.token)).toMatchObject({ voucherId: once.id, discountCents: 10_500 });

    await app.prisma.order.update({
      where: { tokenHash: hashSessionValue(second.token) },
      data: { status: 'CANCELLED', paidAt: new Date(), paidVia: 'MANUAL', cancelledAt: new Date() },
    });
    await expect(placeNow(basket(shop, 10_500, { voucherCode: 'ONCE' }))).rejects.toBeInstanceOf(PricesChangedError);
  });

  it('a 100% voucher makes a free order: paid at once by voucher, its digital line delivered, and the trial still counts it', async () => {
    const shop = await aShop({ ordersPlaced: 1 });
    const free = await aVoucher(shop, { mode: 'CODE', code: 'FREE100', percent: 100 });

    const before = Date.now();
    const placed = await placeNow({
      ...basket(shop, 0, { voucherCode: 'FREE100' }),
      lines: [{ itemId: shop.course, optionId: null, quantity: 1 }],
      method: null,
      day: null,
      email: 'aisyah@example.com',
    });

    expect(placed.totalCents).toBe(0);
    const order = await orderOf(placed.token);
    expect(order).toMatchObject({ itemsCents: 7_900, discountCents: 7_900, totalCents: 0, status: 'PAID', paidVia: 'VOUCHER', voucherId: free.id, voucherLabel: 'FREE100' });
    expect(order.paidAt!.getTime()).toBeGreaterThanOrEqual(before);
    // deliverOrder ran in the placement: the order is sent.
    expect(order.sentAt).toEqual(order.paidAt);
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: shop.pageId }, select: { ordersPlaced: true } })).ordersPlaced).toBe(2);

    // The buyer gets their delivery email, as any paid digital order; the owner is told it is paid with a voucher.
    await vi.waitFor(() => expect(mailQueue.add).toHaveBeenCalledTimes(2));
    const mails = mailQueue.add.mock.calls.map((call) => call[1]);
    const buyer = mails.find((m) => m.to === 'aisyah@example.com');
    expect(buyer?.text).toContain('Video course');
    const owner = mails.find((m) => m.to === shop.email);
    expect(owner).toMatchObject({ audience: 'owner', subject: expect.stringContaining('· RM0 · Paid') });
    expect(owner?.text).toContain('nothing to pay and no receipt to check');
    expect(owner?.text).toContain('FREE100: −RM79');
  });

  it('a free physical order is paid but has nothing to send', async () => {
    const shop = await aShop();
    await aVoucher(shop, { mode: 'AUTO', name: 'All free', percent: 100 });
    const placed = await placeNow(basket(shop, 0));
    expect(await orderOf(placed.token)).toMatchObject({ totalCents: 0, status: 'PAID', paidVia: 'VOUCHER', sentAt: null });
  });

  it("the owner's new-order email shows the voucher above the discounted total", async () => {
    const shop = await aShop();
    await aVoucher(shop, { mode: 'CODE', code: 'RAYA10', kind: 'AMOUNT', amountCents: 950 });
    await placeNow(basket(shop, 20_050, { voucherCode: 'RAYA10' }));
    await vi.waitFor(() => expect(mailQueue.add).toHaveBeenCalledTimes(1));
    const mail = mailQueue.add.mock.calls[0]![1];
    expect(mail.text).toContain('RAYA10: −RM9.50');
    expect(mail.text).toContain('Total: RM200.50');
    expect(mail.text).toContain('They pay you directly');
  });
});

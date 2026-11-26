import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashSessionValue, MAIL_QUEUE, type MailJobData, type PushJobData } from '@curios/core';
import { openDays } from '@curios/core/orders';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';

/**
 * Paying first, by the owner's QR or bank: the order request carries the receipt, so the order is
 * created already "to check" (placed, a receipt on it) and never visible as waiting for payment.
 */

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };
const pushQueue = { add: vi.fn(async (_name: string, _data: PushJobData, _opts?: unknown) => ({})) };
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let nth = 0;
/** A fresh source address per request, so the per-IP limiter never sees a flood. */
const from = () => `203.0.118.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // With PAYMENT_SECRETS_KEY (always set in production): orders keep a sealed copy of their link, so a repeat can return it.
  app = await buildApp({ orders: { mailQueue, pushQueue, store }, shopChip: { clientFor: () => { throw new Error('no CHIP here'); }, secretsKey: randomBytes(32), production: false } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  mailQueue.add.mockClear();
  pushQueue.add.mockClear();
  store.put.mockClear();
  store.remove.mockClear();
});

async function aShop(options: { notifyOrders?: boolean; notifyReceipts?: boolean } = {}) {
  const slug = `pr-${randomUUID().slice(0, 8)}`;
  const email = `pr-${randomUUID()}@example.com`;
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
          notifyOrders: options.notifyOrders ?? true,
          notifyReceipts: options.notifyReceipts ?? true,
          items: {
            create: [
              { name: 'Kek coklat moist', slug: 'kek', priceCents: 17_000, position: 0 },
              { name: 'Kelas', slug: 'kelas', priceCents: 5_000, position: 1, kind: 'DIGITAL', delivery: 'CODES' },
            ],
          },
        },
      },
    },
    select: { pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true } } } } },
  });
  const page = account.pages[0]!;
  return { handle: slug, email, pageId: page.id, cakeId: page.items[0]!.id, codesId: page.items[1]!.id };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const firstDay = () => openDays({ now: new Date(), minNoticeDays: 1, closedDays: [] }, 1)[0]!;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

function aBasket(shop: Shop, over: Record<string, unknown> = {}) {
  return {
    lines: [{ itemId: shop.cakeId, optionId: null, quantity: 1 }],
    method: 'PICKUP',
    day: firstDay(),
    customerName: 'Aisyah',
    phone: '012-345 6789',
    address: null,
    note: null,
    consent: true,
    seenTotalCents: 17_000,
    receipt: { contentType: 'image/jpeg', data: JPEG },
    ...over,
  };
}

const place = (shop: Shop, payload: object) => app.inject({ method: 'POST', url: `/store/${shop.handle}/orders`, remoteAddress: from(), payload });
const rows = (shop: Shop) => app.prisma.order.findMany({ where: { pageId: shop.pageId } });

describe('POST /store/:handle/orders with a receipt', () => {
  it('creates the order already to check: placed, with the receipt on it, in one step', async () => {
    const shop = await aShop();
    const res = await place(shop, aBasket(shop));

    expect(res.statusCode).toBe(201);
    // Said in the answer, so the browser only claims "sent" for an order that really holds its receipt.
    expect(res.json().receipt).toBe(true);
    const [order] = await rows(shop);
    expect(order).toMatchObject({ status: 'PLACED', paidAt: null, tokenHash: hashSessionValue(res.json().token), receiptType: 'image/jpeg', receiptRejectedAt: null });
    expect(order!.receiptKey).toMatch(new RegExp(`^receipts/${shop.pageId}/[0-9a-f]{32}\\.jpg$`));
    expect(order!.receiptUploadedAt).toBeInstanceOf(Date);
    expect(store.put).toHaveBeenCalledWith(order!.receiptKey, expect.any(Buffer), 'image/jpeg');
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('takes a PDF too', async () => {
    const shop = await aShop();
    expect((await place(shop, aBasket(shop, { receipt: { contentType: 'application/pdf', data: PDF } }))).statusCode).toBe(201);
    expect((await rows(shop))[0]!.receiptKey).toMatch(/\.pdf$/);
  });

  it('refuses a PDF renamed as an image, an odd type and a file over 5 MB, making and storing nothing', async () => {
    const shop = await aShop();
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5_242_880)]).toString('base64');
    for (const receipt of [
      { contentType: 'image/jpeg', data: PDF },
      { contentType: 'text/html', data: JPEG },
      { contentType: 'application/pdf', data: big },
    ]) {
      const res = await place(shop, aBasket(shop, { receipt }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_RECEIPT');
    }
    expect(await rows(shop)).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: shop.pageId } })).ordersPlaced).toBe(0);
  });

  it('answers STORAGE_NOT_CONFIGURED, making nothing, when uploads are switched off', async () => {
    const off = await buildApp({ orders: { mailQueue, pushQueue, store: null } });
    await off.ready();
    try {
      const shop = await aShop();
      const res = await off.inject({ method: 'POST', url: `/store/${shop.handle}/orders`, remoteAddress: from(), payload: aBasket(shop) });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
      expect(await rows(shop)).toHaveLength(0);
    } finally {
      await off.close();
    }
  });

  it('keeps nothing when the order is refused after the file was stored: the file is removed, no order, no count, no mail', async () => {
    const shop = await aShop();
    const res = await place(shop, aBasket(shop, { seenTotalCents: 99 }));

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PRICES_CHANGED');
    expect(await rows(shop)).toHaveLength(0);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith(store.put.mock.calls[0]![0]);
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: shop.pageId } })).ordersPlaced).toBe(0);
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(pushQueue.add).not.toHaveBeenCalled();
  });

  it('removes the file and makes no order when the basket is sold out', async () => {
    const shop = await aShop();
    const res = await place(
      shop,
      aBasket(shop, { lines: [{ itemId: shop.codesId, optionId: null, quantity: 1 }], method: null, day: null, seenTotalCents: 5_000, email: 'a@example.com' }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOLD_OUT');
    expect(await rows(shop)).toHaveLength(0);
    expect(store.remove).toHaveBeenCalledWith(store.put.mock.calls[0]![0]);
  });

  it('stores nothing when the placement is refused before the lock (a bad phone)', async () => {
    const shop = await aShop();
    const res = await place(shop, aBasket(shop, { phone: 'nope' }));
    expect(res.statusCode).toBe(400);
    expect(await rows(shop)).toHaveLength(0);
    expect(store.put.mock.calls.length).toBe(store.remove.mock.calls.length);
  });

  it('takes no receipt on an order that came to RM0: refused, the file removed', async () => {
    const shop = await aShop();
    await app.prisma.shopVoucher.create({ data: { pageId: shop.pageId, mode: 'AUTO', kind: 'PERCENT', percent: 100, name: 'Free', code: null } });
    const res = await place(shop, aBasket(shop, { seenTotalCents: 0 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ORDER');
    expect(await rows(shop)).toHaveLength(0);
    expect(store.remove).toHaveBeenCalledWith(store.put.mock.calls[0]![0]);
  });

  it('is one notification: the new-order email says the receipt is attached, and no receipt email follows', async () => {
    const shop = await aShop();
    await place(shop, aBasket(shop));

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, data] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe(MAIL_QUEUE);
    expect(data.to).toBe(shop.email);
    expect(data.subject).toBe('New order #1 · RM170 · Receipt to check');
    expect(data.html).toContain('attached the receipt');
    expect(pushQueue.add).toHaveBeenCalledTimes(1);
    expect(pushQueue.add.mock.calls[0]![1]).toMatchObject({ title: 'New order #1 · receipt to check' });
  });

  it('still sends that one email to an owner who only has receipt emails on, and none to one with both off', async () => {
    const receiptsOnly = await aShop({ notifyOrders: false, notifyReceipts: true });
    await place(receiptsOnly, aBasket(receiptsOnly));
    expect(mailQueue.add).toHaveBeenCalledTimes(1);

    mailQueue.add.mockClear();
    const quiet = await aShop({ notifyOrders: false, notifyReceipts: false });
    await place(quiet, aBasket(quiet));
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('an order with no receipt is as it was: waiting for payment, its own email, nothing stored', async () => {
    const shop = await aShop();
    const { receipt: _receipt, ...basket } = aBasket(shop);
    const res = await place(shop, basket);
    expect(res.statusCode).toBe(201);
    expect(res.json().receipt).toBe(false);
    expect((await rows(shop))[0]).toMatchObject({ status: 'PLACED', receiptKey: null, receiptUploadedAt: null });
    expect(store.put).not.toHaveBeenCalled();
    expect(mailQueue.add.mock.calls[0]![1].subject).toBe('New order #1 · RM170');
  });
});

describe('POST /store/:handle/orders with a placeKey (a retry after a lost response)', () => {
  const key = () => randomUUID();

  it('the same key twice is one order: the second answer is the first, nothing more is stored, sent or counted', async () => {
    const shop = await aShop();
    const placeKey = key();
    const first = await place(shop, aBasket(shop, { placeKey }));
    expect(first.statusCode).toBe(201);
    const second = await place(shop, aBasket(shop, { placeKey }));

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await rows(shop)).toHaveLength(1);
    expect((await rows(shop))[0]!.tokenHash).toBe(hashSessionValue(first.json().token));
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: shop.pageId } })).ordersPlaced).toBe(1);
    // One file kept, no second one made; one email and one push.
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    expect(pushQueue.add).toHaveBeenCalledTimes(1);
  });

  it('two at the same time: one order, one file kept, the other deleted, and both are told the same order', async () => {
    const shop = await aShop();
    const placeKey = key();
    const [a, b] = await Promise.all([place(shop, aBasket(shop, { placeKey })), place(shop, aBasket(shop, { placeKey }))]);

    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json()).toEqual(b.json());
    const [order] = await rows(shop);
    expect(await rows(shop)).toHaveLength(1);
    const kept = order!.receiptKey;
    const stored = store.put.mock.calls.map((call) => call[0] as string);
    const removed = store.remove.mock.calls.map((call) => call[0] as string);
    expect(stored).toContain(kept);
    // Every file stored beyond the kept one was removed.
    expect(stored.filter((k) => k !== kept).sort()).toEqual(removed.sort());
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a different key is a different order', async () => {
    const shop = await aShop();
    const a = await place(shop, aBasket(shop, { placeKey: key() }));
    const b = await place(shop, aBasket(shop, { placeKey: key() }));
    expect(a.json().token).not.toBe(b.json().token);
    expect(await rows(shop)).toHaveLength(2);
  });

  it('works for an order with no receipt, and the same key on another shop is its own order', async () => {
    const one = await aShop();
    const two = await aShop();
    const placeKey = key();
    const { receipt: _r, ...plain } = aBasket(one);
    const a = await place(one, { ...plain, placeKey });
    const again = await place(one, { ...plain, placeKey });
    expect(again.json()).toEqual(a.json());
    expect(await rows(one)).toHaveLength(1);
    const { receipt: _r2, ...plain2 } = aBasket(two);
    expect((await place(two, { ...plain2, placeKey })).statusCode).toBe(201);
    expect(await rows(two)).toHaveLength(1);
  });

  it('a refused attempt leaves the key free, so the retry with it can still place the order', async () => {
    const shop = await aShop();
    const placeKey = key();
    expect((await place(shop, aBasket(shop, { placeKey, seenTotalCents: 99 }))).statusCode).toBe(409);
    expect((await place(shop, aBasket(shop, { placeKey }))).statusCode).toBe(201);
    expect(await rows(shop)).toHaveLength(1);
  });

  it('refuses a key that is too short or has odd characters', async () => {
    const shop = await aShop();
    expect((await place(shop, aBasket(shop, { placeKey: 'abc' }))).statusCode).toBe(400);
    expect((await place(shop, aBasket(shop, { placeKey: 'a'.repeat(20) + '!' }))).statusCode).toBe(400);
  });
});

describe('a placeKey is not a way into an order', () => {
  it('stores only a hash of the key, and the order link cannot be computed from anything in the database', async () => {
    const shop = await aShop();
    const placeKey = randomUUID();
    const res = await place(shop, aBasket(shop, { placeKey }));
    const [order] = await rows(shop);

    expect(order!.placeKeyHash).toBe(hashSessionValue(placeKey));
    expect(order!.placeKeyHash).not.toBe(placeKey);
    // The old derivation (page + key, no secret) must not give the link, and the link itself is not in any column.
    const derived = createHash('sha256').update(`curios-order-token:${shop.pageId}:${placeKey}`).digest('base64url');
    expect(res.json().token).not.toBe(derived);
    expect(order!.tokenHash).not.toBe(hashSessionValue(derived));
    expect(JSON.stringify(order)).not.toContain(res.json().token);
    expect(JSON.stringify(order)).not.toContain(placeKey);
  });

  it('the repeat returns the very same link, which opens the same order', async () => {
    const shop = await aShop();
    const placeKey = randomUUID();
    const first = await place(shop, aBasket(shop, { placeKey }));
    const again = await place(shop, aBasket(shop, { placeKey }));
    expect(again.json()).toEqual(first.json());
    expect((await rows(shop))[0]!.tokenHash).toBe(hashSessionValue(again.json().token));
    expect(again.json().receipt).toBe(true);
  });

  it('with no sealing key (development) the repeat gets a new link for the same order, and the old one stops', async () => {
    const bare = await buildApp({ orders: { mailQueue, pushQueue, store }, shopChip: { clientFor: () => { throw new Error('no CHIP here'); }, secretsKey: null, production: false } });
    await bare.ready();
    try {
      const shop = await aShop();
      const placeKey = randomUUID();
      const send = () => bare.inject({ method: 'POST', url: `/store/${shop.handle}/orders`, remoteAddress: from(), payload: aBasket(shop, { placeKey }) });
      const first = await send();
      const again = await send();
      expect(again.statusCode).toBe(201);
      expect(again.json()).toMatchObject({ number: first.json().number, code: first.json().code });
      expect(again.json().token).not.toBe(first.json().token);
      const all = await rows(shop);
      expect(all).toHaveLength(1);
      expect(all[0]!.tokenHash).toBe(hashSessionValue(again.json().token));
    } finally {
      await bare.close();
    }
  });
});

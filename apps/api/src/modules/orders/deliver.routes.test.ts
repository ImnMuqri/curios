import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChipClient, ChipPurchase } from '@curios/billing';
import { hashSessionValue, type MailJobData } from '@curios/core';
import { openSecret, sealSecret } from '@curios/core/secret-box';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { createDiskPrivateFiles, type PrivateFiles } from '../store/private-files.js';

const SECRETS_KEY = randomBytes(32);
const SECRET = 'owner-chip-secret-key-0123456789abcdefghij';
const DAY = 24 * 3_600_000;
const ownerKey = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

const client = {
  createPurchase: vi.fn<ChipClient['createPurchase']>(),
  getPurchase: vi.fn<ChipClient['getPurchase']>(),
  chargePurchase: vi.fn<ChipClient['chargePurchase']>(),
  deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
  cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
  getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
  listPaymentMethods: vi.fn<ChipClient['listPaymentMethods']>(),
};
const clientFor = vi.fn((_credentials: { secretKey: string; brandId: string }): ChipClient => client);
const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };
const store: AvatarStore = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };

let app: FastifyInstance;
let privateFiles: PrivateFiles;
let root: string;
let nth = 0;
const from = () => `203.0.117.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'curios-deliver-'));
  privateFiles = createDiskPrivateFiles(root);
  app = await buildApp({
    orders: { mailQueue, store, payStatusEveryMs: 0 },
    privateFiles,
    shopChip: { clientFor, secretsKey: SECRETS_KEY, production: false, callbackBaseUrl: 'https://api.curios.example' },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  mailQueue.add.mockClear();
  for (const fn of Object.values(client)) fn.mockReset();
});

/** One shop with a cake, an e-book of two files, a link, three codes, and class times (2 seats, 1 seat, plus another class's time). */
async function aShop() {
  const slug = `dl-${randomUUID().slice(0, 8)}`;
  const email = `dl-${randomUUID()}@example.com`;
  const account = await app.prisma.account.create({
    data: {
      email,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Kek Lina',
          language: 'ms',
          published: true,
          mode: 'BUSINESS',
          storeEnabled: true,
          pickupEnabled: true,
          minNoticeDays: 1,
          items: {
            create: [
              { name: 'Kek', slug: 'kek', priceCents: 5_000, position: 0 },
              {
                name: 'Recipe e-book',
                slug: 'ebook',
                priceCents: 2_500,
                position: 1,
                kind: 'DIGITAL',
                delivery: 'FILES',
                files: {
                  create: [
                    { key: `digital/${slug}/a`, name: 'recipe one.pdf', sizeBytes: 5, contentType: 'application/pdf', position: 0 },
                    { key: `digital/${slug}/b`, name: 'recipe two.pdf', sizeBytes: 5, contentType: 'application/pdf', position: 1 },
                  ],
                },
              },
              { name: 'Video course', slug: 'course', priceCents: 7_900, position: 2, kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/course', accessNote: 'Start with video one' },
              { name: 'Gift voucher', slug: 'voucher', priceCents: 5_000, position: 3, kind: 'DIGITAL', delivery: 'CODES', codes: { create: [{ code: 'C-1' }, { code: 'C-2' }, { code: 'C-3' }] } },
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
                sessions: {
                  create: [
                    { startsAt: new Date(Date.now() + 7 * DAY), seats: 2 },
                    { startsAt: new Date(Date.now() + 8 * DAY), seats: 1 },
                    { startsAt: new Date(Date.now() + 9 * DAY), seats: 5 },
                  ],
                },
              },
              {
                name: 'Other class',
                slug: 'other',
                priceCents: 6_000,
                position: 5,
                kind: 'DIGITAL',
                delivery: 'SESSION',
                sessionMinutes: 60,
                sessionPlace: 'IN_PERSON',
                sessionWhere: 'Kedai Lina, Ipoh',
                sessions: { create: [{ startsAt: new Date(Date.now() + 7 * DAY), seats: 5 }] },
              },
            ],
          },
        },
      },
    },
    select: {
      id: true,
      pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true, files: { orderBy: { position: 'asc' }, select: { key: true } }, sessions: { orderBy: { startsAt: 'asc' }, select: { id: true } } } } } },
    },
  });
  const page = account.pages[0]!;
  const [cake, ebook, course, voucher, cls, other] = page.items;
  for (const f of ebook!.files) await privateFiles.put(f.key, Buffer.from('hello'), 'application/pdf', 5);
  return {
    handle: slug,
    email,
    accountId: account.id,
    pageId: page.id,
    cake: cake!.id,
    ebook: ebook!.id,
    course: course!.id,
    voucher: voucher!.id,
    cls: cls!.id,
    times: cls!.sessions.map((s) => s.id) as [string, string, string],
    otherTime: other!.sessions[0]!.id,
  };
}
type Shop = Awaited<ReturnType<typeof aShop>>;

const buyer = { customerName: 'Mira', phone: '012-345 6789', address: null, note: null, consent: true, email: 'mira@example.com' };
const line = (itemId: string, over: Record<string, unknown> = {}) => ({ itemId, optionId: null, quantity: 1, ...over });
async function placeDigital(shop: Shop, lines: object[], total: number) {
  const res = await app.inject({ method: 'POST', url: `/store/${shop.handle}/orders`, remoteAddress: from(), payload: { ...buyer, lines, seenTotalCents: total } });
  expect(res.statusCode).toBe(201);
  const token: string = res.json().token;
  const order = await app.prisma.order.findUniqueOrThrow({ where: { tokenHash: hashSessionValue(token) }, include: { lines: { orderBy: { position: 'asc' } } } });
  return { token, order };
}
const cookieOf = async (accountId: string) => (await createSession(app.prisma, accountId)).value;
const ownerPost = async (shop: Shop, orderId: string, action: string, payload?: object, accountId = shop.accountId) =>
  app.inject({ method: 'POST', url: `/orders/${orderId}/${action}`, remoteAddress: from(), cookies: { [SESSION_COOKIE]: await cookieOf(accountId) }, ...(payload ? { payload } : {}) });
const grantsOf = (orderId: string) => app.prisma.downloadGrant.findMany({ where: { orderLine: { orderId } }, orderBy: { createdAt: 'asc' } });
const download = (token: string, grantId: string) => app.inject({ method: 'GET', url: `/store/orders/${token}/files/${grantId}`, remoteAddress: from() });
const subjects = () => mailQueue.add.mock.calls.map((c) => c[1].subject);
const mailTo = (to: string) => mailQueue.add.mock.calls.map((c) => c[1]).filter((m) => m.to === to);

/** A shop order of the e-book, paid by the owner marking it so, ready to download. */
async function sentEbook(shop?: Shop) {
  const s = shop ?? (await aShop());
  const placed = await placeDigital(s, [line(s.ebook)], 2_500);
  expect((await ownerPost(s, placed.order.id, 'paid')).statusCode).toBe(204);
  return { shop: s, ...placed, grants: await grantsOf(placed.order.id) };
}

describe('placing seals the order link', () => {
  it('stores the token sealed, so a later email can open it', async () => {
    const shop = await aShop();
    const { token, order } = await placeDigital(shop, [line(shop.ebook)], 2_500);
    expect(order.tokenSealed).not.toBeNull();
    expect(openSecret(order.tokenSealed!, SECRETS_KEY)).toBe(token);
  });
});

describe('delivering a paid order', () => {
  it('marking paid delivers: grants per file, codes given, one email to the buyer with links', async () => {
    const shop = await aShop();
    const { token, order } = await placeDigital(shop, [line(shop.ebook), line(shop.course), line(shop.voucher, { quantity: 2 }), line(shop.cls, { sessionId: shop.times[0] })], 26_400);
    expect(order.sentAt).toBeNull();
    mailQueue.add.mockClear();
    expect((await ownerPost(shop, order.id, 'paid')).statusCode).toBe(204);

    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PAID');
    expect(after.sentAt).toBeInstanceOf(Date);
    const grants = await grantsOf(order.id);
    expect(grants.map((g) => g.fileName).sort()).toEqual(['recipe one.pdf', 'recipe two.pdf']);
    for (const g of grants) {
      expect(g.usesLeft).toBe(5);
      expect(g.token).toMatch(/^[0-9a-f]{32}$/);
      expect(g.expiresAt.getTime() - after.sentAt!.getTime()).toBe(30 * DAY);
    }
    const codes = await app.prisma.itemCode.findMany({ where: { orderLine: { orderId: order.id } } });
    expect(codes).toHaveLength(2);
    expect(codes.every((c) => c.givenAt !== null)).toBe(true);

    const mails = mailTo('mira@example.com');
    expect(mails).toHaveLength(1);
    const text = mails[0]!.text;
    expect(mails[0]!.subject).toContain(`#${order.number}`);
    // The customer's email: no audience, so "Emails to owners" off never stops it.
    expect(mails[0]!.audience).toBeUndefined();
    for (const g of grants) expect(text).toContain(`/store/orders/${token}/files/${g.id}`);
    expect(text).toContain(`/store/orders/${token}/link/${order.lines[1]!.id}`);
    expect(text).not.toContain('https://example.com/course');
    expect(text).toContain('Start with video one');
    for (const c of codes) expect(text).toContain(c.code);
    expect(text).toContain('https://meet.example.com/abc');
    expect(text).toContain(`/${shop.handle}/order/${token}`);
    // Malay page: the email is in Malay.
    expect(text).toContain('Muat turun');
    // The owner marked it paid themselves: no email of their own.
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a physical-only order is paid but never sent', async () => {
    const shop = await aShop();
    const order = await app.prisma.order.create({
      data: {
        pageId: shop.pageId,
        number: 901,
        code: 'ZZ99',
        tokenHash: hashSessionValue(randomBytes(8).toString('hex')),
        customerName: 'Aisyah',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-12-01T00:00:00Z'),
        itemsCents: 5_000,
        deliveryCents: 0,
        totalCents: 5_000,
        lines: { create: [{ itemId: shop.cake, itemName: 'Kek', unitPriceCents: 5_000, quantity: 1, position: 0 }] },
      },
    });
    expect((await ownerPost(shop, order.id, 'paid')).statusCode).toBe(204);
    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PAID');
    expect(after.sentAt).toBeNull();
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect((await ownerPost(shop, order.id, 'resend')).statusCode).toBe(409);
  });

  it('two owner taps at once deliver once', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.ebook), line(shop.voucher)], 7_500);
    const results = await Promise.all([ownerPost(shop, order.id, 'paid'), ownerPost(shop, order.id, 'paid')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(await grantsOf(order.id)).toHaveLength(2);
    expect(mailTo('mira@example.com')).toHaveLength(1);
  });

  it('a mail that cannot be queued does not undo the delivery', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.ebook)], 2_500);
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));
    expect((await ownerPost(shop, order.id, 'paid')).statusCode).toBe(204);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).sentAt).not.toBeNull();
    expect(await grantsOf(order.id)).toHaveLength(2);
  });
});

describe('delivering through CHIP', () => {
  async function chipShop() {
    const shop = await aShop();
    await app.prisma.shopPaymentAccount.create({
      data: { pageId: shop.pageId, brandId: randomUUID(), secretKeyCiphertext: sealSecret(SECRET, SECRETS_KEY), publicKeyPem: ownerKey.publicKey, methods: ['fpx'], isTest: false, checkedAt: new Date() },
    });
    const placed = await placeDigital(shop, [line(shop.ebook), line(shop.voucher)], 7_500);
    const purchase: ChipPurchase = {
      id: `purchase-${randomUUID()}`,
      status: 'paid',
      reference: String(placed.order.number),
      totalCents: 7_500,
      checkoutUrl: 'https://gate.chip-in.asia/p/x/',
      isRecurringToken: false,
      isTest: false,
      paymentMethod: 'fpx',
      maskedPan: null,
      notes: 'FPX · Maybank2u',
      referenceGenerated: 'CH0042',
    };
    await app.prisma.order.update({ where: { id: placed.order.id }, data: { chipPurchaseId: purchase.id } });
    client.getPurchase.mockResolvedValue(purchase);
    mailQueue.add.mockClear();
    return { shop, purchase, ...placed };
  }
  const callback = (orderId: string, purchaseId: string) => {
    const body = JSON.stringify({ id: purchaseId, event_type: 'purchase.paid', status: 'paid', reference: '1', purchase: { total: 7_500 } });
    return app.inject({
      method: 'POST',
      url: `/store/chip/callback/${orderId}`,
      headers: { 'content-type': 'application/json', 'x-signature': sign('sha256', Buffer.from(body), ownerKey.privateKey).toString('base64') },
      payload: body,
    });
  };

  it('delivers once, and a replayed webhook does not deliver again; the owner is told it is paid and sent', async () => {
    const { order, purchase } = await chipShop();
    expect((await callback(order.id, purchase.id)).json()).toEqual({ status: 'paid' });
    expect((await callback(order.id, purchase.id)).json()).toEqual({ status: 'already-paid' });
    expect(await grantsOf(order.id)).toHaveLength(2);
    expect(mailTo('mira@example.com')).toHaveLength(1);
    expect(subjects().filter((s) => s.endsWith('Paid and sent'))).toHaveLength(1);
    expect(mailQueue.add).toHaveBeenCalledTimes(2);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).sentAt).not.toBeNull();
  });

  it('a callback and the owner marking paid at once deliver once', async () => {
    const { shop, order, purchase } = await chipShop();
    await Promise.all([callback(order.id, purchase.id), ownerPost(shop, order.id, 'paid')]);
    expect(await grantsOf(order.id)).toHaveLength(2);
    expect(mailTo('mira@example.com')).toHaveLength(1);
    const codes = await app.prisma.itemCode.findMany({ where: { orderLine: { orderId: order.id } } });
    expect(codes.every((c) => c.givenAt !== null)).toBe(true);
  });

  it('a late payment on a cancelled order is not delivered', async () => {
    const { shop, order, purchase } = await chipShop();
    expect((await ownerPost(shop, order.id, 'cancel')).statusCode).toBe(204);
    expect((await callback(order.id, purchase.id)).json()).toEqual({ status: 'paid-after-cancel' });
    expect(await grantsOf(order.id)).toHaveLength(0);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).sentAt).toBeNull();
    expect(mailTo('mira@example.com')).toHaveLength(0);
  });
});

describe('GET /store/orders/:token/files/:grantId', () => {
  it('streams the file as an attachment, five times, then 410 DOWNLOAD_USED_UP', async () => {
    const { token, grants } = await sentEbook();
    const grant = grants[0]!;
    for (let n = 1; n <= 5; n++) {
      const res = await download(token, grant.id);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('hello');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(grant.fileName)}`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
    const sixth = await download(token, grant.id);
    expect(sixth.statusCode).toBe(410);
    expect(sixth.json().error.code).toBe('DOWNLOAD_USED_UP');
    // The other file has its own five.
    expect((await download(token, grants[1]!.id)).statusCode).toBe(200);
  });

  it('sends a browser to the order page when the download is used up, expired or the order unpaid; JSON for anything else', async () => {
    const { shop, token, order, grants } = await sentEbook();
    const html = { accept: 'text/html,application/xhtml+xml' };
    const get = (url: string, headers?: Record<string, string>) => app.inject({ method: 'GET', url, headers, remoteAddress: from() });
    const files = (id: string) => `/store/orders/${token}/files/${id}`;
    const orderPage = `/${shop.handle}/order/${token}#downloads`;
    for (let n = 1; n <= 5; n++) expect((await get(files(grants[0]!.id))).statusCode).toBe(200);
    const sixth = await get(files(grants[0]!.id), html);
    expect(sixth.statusCode).toBe(303);
    expect(String(sixth.headers.location).endsWith(orderPage)).toBe(true);
    const json = await get(files(grants[0]!.id));
    expect(json.statusCode).toBe(410);
    expect(json.json().error.code).toBe('DOWNLOAD_USED_UP');

    await app.prisma.downloadGrant.update({ where: { id: grants[1]!.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await get(files(grants[1]!.id), html)).statusCode).toBe(303);
    expect((await get(files('nope'), html)).statusCode).toBe(303);
    // A wrong token is not an order of ours: no redirect, even for a browser.
    expect((await get(`/store/orders/wrong-token/files/${grants[0]!.id}`, html)).statusCode).toBe(404);

    expect((await ownerPost(shop, order.id, 'cancel')).statusCode).toBe(204);
    expect((await get(files(grants[1]!.id), html)).statusCode).toBe(303);
    expect((await get(files(grants[1]!.id))).statusCode).toBe(410);
  });

  it('the link route sends a browser to the order page when the order is unpaid', async () => {
    const shop = await aShop();
    const { token, order } = await placeDigital(shop, [line(shop.course)], 7_900);
    const url = `/store/orders/${token}/link/${order.lines[0]!.id}`;
    const res = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' }, remoteAddress: from() });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain(`/${shop.handle}/order/${token}#downloads`);
    expect((await app.inject({ method: 'GET', url, remoteAddress: from() })).statusCode).toBe(410);
  });

  it('counts exactly five when eight ask at once', async () => {
    const { token, grants } = await sentEbook();
    const results = await Promise.all(Array.from({ length: 8 }, () => download(token, grants[0]!.id)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 410)).toHaveLength(3);
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: grants[0]!.id } })).usesLeft).toBe(0);
  });

  it('is 410 DOWNLOAD_EXPIRED after 30 days, spending nothing', async () => {
    const { token, grants } = await sentEbook();
    await app.prisma.downloadGrant.update({ where: { id: grants[0]!.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const res = await download(token, grants[0]!.id);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('DOWNLOAD_EXPIRED');
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: grants[0]!.id } })).usesLeft).toBe(5);
  });

  it('is 410 ORDER_NOT_PAID once the order is cancelled', async () => {
    const { shop, token, order, grants } = await sentEbook();
    expect((await ownerPost(shop, order.id, 'cancel')).statusCode).toBe(204);
    const res = await download(token, grants[0]!.id);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('ORDER_NOT_PAID');
  });

  it('is 404 for another order’s grant, an unknown grant and a wrong token', async () => {
    const a = await sentEbook();
    const b = await sentEbook();
    expect((await download(a.token, b.grants[0]!.id)).statusCode).toBe(404);
    expect((await download(a.token, 'nope')).statusCode).toBe(404);
    expect((await download('wrong-token', a.grants[0]!.id)).statusCode).toBe(404);
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: b.grants[0]!.id } })).usesLeft).toBe(5);
  });

  it('gives back the use when the stored file cannot be read', async () => {
    const { token, grants, shop } = await sentEbook();
    await rm(path.join(root, 'digital', shop.handle), { recursive: true, force: true });
    const res = await download(token, grants[0]!.id);
    expect(res.statusCode).toBe(500);
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: grants[0]!.id } })).usesLeft).toBe(5);
  });
});

describe('HEAD on the download routes', () => {
  it('spends no use and opens no link', async () => {
    const { token, grants, order, shop } = await sentEbook();
    const head = await app.inject({ method: 'HEAD', url: `/store/orders/${token}/files/${grants[0]!.id}`, remoteAddress: from() });
    expect(head.statusCode).toBe(404);
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: grants[0]!.id } })).usesLeft).toBe(5);

    const placed = await placeDigital(shop, [line(shop.course)], 7_900);
    await ownerPost(shop, placed.order.id, 'paid');
    const lineId = placed.order.lines[0]!.id;
    const headLink = await app.inject({ method: 'HEAD', url: `/store/orders/${placed.token}/link/${lineId}`, remoteAddress: from() });
    expect(headLink.statusCode).toBe(404);
    expect((await app.prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } })).linkOpenedAt).toBeNull();
    void order;
  });
});

describe('GET /store/orders/:token/link/:lineId', () => {
  it('redirects to the link as sold, and records that it was opened once', async () => {
    const shop = await aShop();
    const { token, order } = await placeDigital(shop, [line(shop.course)], 7_900);
    const url = `/store/orders/${token}/link/${order.lines[0]!.id}`;
    const unpaid = await app.inject({ method: 'GET', url, remoteAddress: from() });
    expect(unpaid.statusCode).toBe(410);
    expect(unpaid.json().error.code).toBe('ORDER_NOT_PAID');

    await ownerPost(shop, order.id, 'paid');
    // The owner edits the item afterwards: the buyer still gets what they bought.
    await app.prisma.item.update({ where: { id: shop.course }, data: { accessUrl: 'https://example.com/changed' } });
    const res = await app.inject({ method: 'GET', url, remoteAddress: from() });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/course');
    const first = (await app.prisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } })).linkOpenedAt;
    expect(first).toBeInstanceOf(Date);
    await app.inject({ method: 'GET', url, remoteAddress: from() });
    expect((await app.prisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } })).linkOpenedAt).toEqual(first);
  });

  it('is 404 for a line of another order or one that is not a link', async () => {
    const shop = await aShop();
    const a = await placeDigital(shop, [line(shop.course)], 7_900);
    const b = await placeDigital(shop, [line(shop.ebook)], 2_500);
    await ownerPost(shop, a.order.id, 'paid');
    await ownerPost(shop, b.order.id, 'paid');
    expect((await app.inject({ method: 'GET', url: `/store/orders/${a.token}/link/${b.order.lines[0]!.id}`, remoteAddress: from() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/store/orders/${b.token}/link/${b.order.lines[0]!.id}`, remoteAddress: from() })).statusCode).toBe(404);
  });
});

describe('an item edited after the sale', () => {
  it('still delivers what was sold when the items are made physical before the order is marked paid', async () => {
    const shop = await aShop();
    const linkOrder = await placeDigital(shop, [line(shop.course)], 7_900);
    const filesOrder = await placeDigital(shop, [line(shop.ebook)], 2_500);
    // The owner switches both items to physical before marking either order paid.
    for (const id of [shop.course, shop.ebook]) {
      const patched = await app.inject({ method: 'PATCH', url: `/store/items/${id}`, remoteAddress: from(), cookies: { [SESSION_COOKIE]: await cookieOf(shop.accountId) }, payload: { kind: 'PHYSICAL' } });
      expect(patched.statusCode).toBe(200);
    }
    mailQueue.add.mockClear();
    expect((await ownerPost(shop, linkOrder.order.id, 'paid')).statusCode).toBe(204);
    expect((await ownerPost(shop, filesOrder.order.id, 'paid')).statusCode).toBe(204);

    // Files: one grant per file the item has, and the download works.
    const grants = await grantsOf(filesOrder.order.id);
    expect(grants.map((g) => g.fileName).sort()).toEqual(['recipe one.pdf', 'recipe two.pdf']);
    expect((await download(filesOrder.token, grants[0]!.id)).statusCode).toBe(200);
    // Link: the SOLD url, from the line's own copy.
    const lineId = linkOrder.order.lines[0]!.id;
    const res = await app.inject({ method: 'GET', url: `/store/orders/${linkOrder.token}/link/${lineId}`, remoteAddress: from() });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/course');
    // The delivery mail is built from the snapshots on the lines.
    const mails = mailTo('mira@example.com');
    expect(mails).toHaveLength(2);
    const linkMail = mails.find((m) => m.text.includes(`/link/${lineId}`))!;
    expect(linkMail.text).toContain('Video course');
    expect(linkMail.text).toContain('Start with video one');
    const filesMail = mails.find((m) => m.text.includes('recipe one.pdf'))!;
    for (const g of grants) expect(filesMail.text).toContain(`/files/${g.id}`);
  });
});

describe('owner actions on a delivered order', () => {
  it('resend queues the delivery email again with the live links; not for another owner or an unsent order', async () => {
    const { shop, order, token } = await sentEbook();
    mailQueue.add.mockClear();
    expect((await ownerPost(shop, order.id, 'resend')).statusCode).toBe(204);
    const mails = mailTo('mira@example.com');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain(`/store/orders/${token}/files/`);

    const other = await aShop();
    expect((await ownerPost(shop, order.id, 'resend', undefined, other.accountId)).statusCode).toBe(404);
    const unsent = await placeDigital(shop, [line(shop.ebook)], 2_500);
    expect((await ownerPost(shop, unsent.order.id, 'resend')).statusCode).toBe(409);
  });

  it('new-links makes fresh grants, leaves the old to expire, and a resend carries only the new ones', async () => {
    const { shop, order, token, grants } = await sentEbook();
    for (let n = 0; n < 5; n++) await download(token, grants[0]!.id);
    expect((await download(token, grants[0]!.id)).statusCode).toBe(410);

    expect((await ownerPost(shop, order.id, 'new-links')).statusCode).toBe(204);
    const all = await grantsOf(order.id);
    expect(all).toHaveLength(4);
    const fresh = all.filter((g) => !grants.some((o) => o.id === g.id));
    expect(fresh.every((g) => g.usesLeft === 5)).toBe(true);
    expect((await app.prisma.downloadGrant.findUniqueOrThrow({ where: { id: grants[0]!.id } })).usesLeft).toBe(0);
    const newForFirst = fresh.find((g) => g.fileId === grants[0]!.fileId)!;
    expect((await download(token, newForFirst.id)).statusCode).toBe(200);

    mailQueue.add.mockClear();
    await ownerPost(shop, order.id, 'resend');
    const text = mailTo('mira@example.com')[0]!.text;
    for (const g of fresh) expect(text).toContain(g.id);
    for (const g of grants) expect(text).not.toContain(g.id);
  });

  it('new-links needs a delivered, paid order', async () => {
    const { shop, order } = await sentEbook();
    await ownerPost(shop, order.id, 'cancel');
    expect((await ownerPost(shop, order.id, 'new-links')).statusCode).toBe(409);
  });

  it('new-code gives another unused code, then 409 SOLD_OUT; only for a CODES line of that order', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.voucher, { quantity: 2 }), line(shop.ebook)], 12_500);
    await ownerPost(shop, order.id, 'paid');
    const codeLine = order.lines[0]!.id;
    expect(await app.prisma.itemCode.count({ where: { orderLineId: codeLine } })).toBe(2);

    const ok = await ownerPost(shop, order.id, 'new-code', { lineId: codeLine });
    expect(ok.statusCode).toBe(204);
    const held = await app.prisma.itemCode.findMany({ where: { orderLineId: codeLine } });
    expect(held).toHaveLength(3);
    expect(held.every((c) => c.givenAt !== null)).toBe(true);

    const none = await ownerPost(shop, order.id, 'new-code', { lineId: codeLine });
    expect(none.statusCode).toBe(409);
    expect(none.json().error.code).toBe('SOLD_OUT');
    expect((await ownerPost(shop, order.id, 'new-code', { lineId: order.lines[1]!.id })).statusCode).toBe(404);
  });

  it('two new-code taps at once never take the same code', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.voucher)], 5_000);
    await ownerPost(shop, order.id, 'paid');
    const results = await Promise.all([1, 2].map(() => ownerPost(shop, order.id, 'new-code', { lineId: order.lines[0]!.id })));
    expect(results.map((r) => r.statusCode)).toEqual([204, 204]);
    expect(new Set((await app.prisma.itemCode.findMany({ where: { orderLineId: order.lines[0]!.id } })).map((c) => c.code)).size).toBe(3);
  });

  it('move-time moves the booking to a time with room, and respects seats', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.cls, { quantity: 2, sessionId: shop.times[0] })], 12_000);
    await ownerPost(shop, order.id, 'paid');
    const lineId = order.lines[0]!.id;
    const move = (sessionId: string) => ownerPost(shop, order.id, 'move-time', { lineId, sessionId });
    const booking = () => app.prisma.sessionBooking.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.prisma.sessionBooking.update({ where: { orderLineId: lineId }, data: { remindedAt: new Date() } });

    // One seat only: two do not fit.
    const full = await move(shop.times[1]);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('TIME_FULL');
    // Another class's time.
    expect((await move(shop.otherTime)).statusCode).toBe(409);
    expect((await booking()).sessionId).toBe(shop.times[0]);

    expect((await move(shop.times[2])).statusCode).toBe(204);
    expect(await booking()).toMatchObject({ sessionId: shop.times[2], seats: 2, remindedAt: null });
    // Back into the old time: its seats were freed.
    expect((await move(shop.times[0])).statusCode).toBe(204);
    // Same time again is fine.
    expect((await move(shop.times[0])).statusCode).toBe(204);
  });

  it('two moves at once into the last seat: one wins', async () => {
    const shop = await aShop();
    const a = await placeDigital(shop, [line(shop.cls, { sessionId: shop.times[0] })], 6_000);
    const b = await placeDigital(shop, [line(shop.cls, { sessionId: shop.times[0] })], 6_000);
    await ownerPost(shop, a.order.id, 'paid');
    await ownerPost(shop, b.order.id, 'paid');
    const results = await Promise.all([
      ownerPost(shop, a.order.id, 'move-time', { lineId: a.order.lines[0]!.id, sessionId: shop.times[1] }),
      ownerPost(shop, b.order.id, 'move-time', { lineId: b.order.lines[0]!.id, sessionId: shop.times[1] }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(await app.prisma.sessionBooking.count({ where: { sessionId: shop.times[1] } })).toBe(1);
  });

  it('refuses every owner action with 410 PAGE_UNAVAILABLE while the shop is suspended', async () => {
    const shop = await aShop();
    const { order } = await placeDigital(shop, [line(shop.ebook), line(shop.voucher), line(shop.cls, { sessionId: shop.times[0] })], 13_500);
    expect((await ownerPost(shop, order.id, 'paid')).statusCode).toBe(204);
    const lines = await app.prisma.orderLine.findMany({ where: { orderId: order.id }, select: { id: true, delivery: true } });
    const codeLine = lines.find((l) => l.delivery === 'CODES')!.id;
    const timeLine = lines.find((l) => l.delivery === 'SESSION')!.id;
    await app.prisma.page.update({ where: { id: shop.pageId }, data: { suspendedAt: new Date() } });
    mailQueue.add.mockClear();
    const grantsBefore = (await grantsOf(order.id)).length;
    for (const [action, payload] of [['resend'], ['new-links'], ['new-code', { lineId: codeLine }], ['move-time', { lineId: timeLine, sessionId: shop.times[1] }]] as const) {
      const res = await ownerPost(shop, order.id, action, payload);
      expect(res.statusCode, action).toBe(410);
      expect(res.json().error.code, action).toBe('PAGE_UNAVAILABLE');
    }
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await grantsOf(order.id)).toHaveLength(grantsBefore);
    expect((await app.prisma.sessionBooking.findFirstOrThrow({ where: { orderLine: { orderId: order.id } } })).sessionId).toBe(shop.times[0]);
  });

  it('every action needs the owner’s own order and a session', async () => {
    const { shop, order } = await sentEbook();
    const other = await aShop();
    for (const action of ['new-links', 'new-code', 'move-time']) {
      const res = await ownerPost(shop, order.id, action, { lineId: 'x', sessionId: 'y' }, other.accountId);
      expect(res.statusCode).toBe(404);
    }
    const res = await app.inject({ method: 'POST', url: `/orders/${order.id}/resend`, remoteAddress: from() });
    expect(res.statusCode).toBe(401);
  });
});

import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChipRefusedError, ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { hashSessionValue, type MailJobData } from '@curios/core';
import { sealSecret } from '@curios/core/secret-box';
import { COUNTED_ORDER_WHERE } from '@curios/core/vouchers';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

const SECRETS_KEY = randomBytes(32);
const SECRET = 'owner-chip-secret-key-0123456789abcdefghij';
const CALLBACK_BASE = 'https://api.curios.example';
const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const ALL_METHODS = ['fpx', 'visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'duitnow_qr'];

/** A CHIP signing key: the owner's account's, another shop's, and Curios's own. */
const keyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ownerKey = keyPair();
const otherShopKey = keyPair();
const curiosKey = keyPair();
const signWith = (privateKey: string, body: string) => sign('sha256', Buffer.from(body), privateKey).toString('base64');

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
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let live: FastifyInstance;
/** As app, but asking CHIP about one order at most once every 5s, as production does. */
let throttled: FastifyInstance;
let nth = 0;
const from = () => `203.0.121.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: false, callbackBaseUrl: CALLBACK_BASE }, orders: { mailQueue, store, payStatusEveryMs: 0 } });
  live = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: true, callbackBaseUrl: CALLBACK_BASE }, orders: { mailQueue, store, payStatusEveryMs: 0 } });
  throttled = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: false, callbackBaseUrl: CALLBACK_BASE }, orders: { mailQueue, store } });
  await Promise.all([app.ready(), live.ready(), throttled.ready()]);
});
afterAll(async () => {
  // SystemSetting is reached by no truncate cascade: the payments switch's row goes here.
  await app.prisma.systemSetting.deleteMany({ where: { key: 'switch.chipPayments' } });
  await Promise.all([app.close(), live.close(), throttled.close()]);
});

function aPurchase(overrides: Partial<ChipPurchase> = {}): ChipPurchase {
  return {
    id: `purchase-${randomUUID()}`,
    status: 'created',
    reference: '1',
    totalCents: 22_000,
    checkoutUrl: 'https://gate.chip-in.asia/p/order-purchase/',
    isRecurringToken: false,
    isTest: false,
    paymentMethod: null,
    maskedPan: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  clientFor.mockClear();
  mailQueue.add.mockClear();
  store.remove.mockClear();
  client.listPaymentMethods.mockResolvedValue(ALL_METHODS);
  client.createPurchase.mockImplementation(async () => aPurchase());
  client.cancelPurchase.mockResolvedValue(undefined);
});

interface ShopOptions {
  connected?: boolean;
  isTest?: boolean;
  lastErrorAt?: Date | null;
  sealedWith?: Buffer;
  publicKeyPem?: string;
}

/** A business shop with an order of RM220: a 2kg cake, two trays of tart, RM10 delivery. */
async function aShopWithOrder(on: FastifyInstance, options: ShopOptions = {}) {
  const slug = `po-${randomUUID().slice(0, 8)}`;
  const brandId = randomUUID();
  const account = await on.prisma.account.create({
    data: {
      email: `pay-${randomUUID()}@example.com`,
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
        },
      },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  if (options.connected ?? true) {
    await on.prisma.shopPaymentAccount.create({
      data: {
        pageId,
        brandId,
        secretKeyCiphertext: sealSecret(SECRET, options.sealedWith ?? SECRETS_KEY),
        publicKeyPem: options.publicKeyPem ?? ownerKey.publicKey,
        methods: ALL_METHODS,
        isTest: options.isTest ?? false,
        checkedAt: new Date(),
        lastErrorAt: options.lastErrorAt ?? null,
      },
    });
  }
  const token = randomBytes(32).toString('base64url');
  const order = await on.prisma.order.create({
    data: {
      pageId,
      number: 1,
      code: 'AB23',
      tokenHash: hashSessionValue(token),
      customerName: 'Aisyah',
      phone: '+60123456789',
      method: 'DELIVERY',
      day: new Date('2026-12-01T00:00:00Z'),
      address: '12 Jalan Mawar',
      itemsCents: 21_000,
      deliveryCents: 1_000,
      totalCents: 22_000,
      lines: {
        create: [
          { itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17_000, quantity: 1, position: 0 },
          { itemName: 'Tart nenas', optionLabel: null, unitPriceCents: 2_000, quantity: 2, position: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { handle: slug, pageId, brandId, token, orderId: order.id, accountId: account.id };
}

type Shop = Awaited<ReturnType<typeof aShopWithOrder>>;

const pay = (on: FastifyInstance, token: string, payload: object) =>
  on.inject({ method: 'POST', url: `/store/orders/${token}/pay`, remoteAddress: from(), payload });
const payStatus = (on: FastifyInstance, token: string) => on.inject({ method: 'GET', url: `/store/orders/${token}/pay-status`, remoteAddress: from() });
const orderOf = (on: FastifyInstance, id: string) => on.prisma.order.findUniqueOrThrow({ where: { id } });
const accountOf = (on: FastifyInstance, pageId: string) => on.prisma.shopPaymentAccount.findUniqueOrThrow({ where: { pageId } });

/** CHIP's callback: the purchase as CHIP posts it, signed (or not) with the key given. */
function callback(on: FastifyInstance, orderId: string, purchaseId: string, privateKey: string | null) {
  const body = JSON.stringify({ id: purchaseId, event_type: 'purchase.paid', status: 'paid', reference: '1', purchase: { total: 22_000 } });
  return on.inject({
    method: 'POST',
    url: `/store/chip/callback/${orderId}`,
    headers: { 'content-type': 'application/json', ...(privateKey ? { 'x-signature': signWith(privateKey, body) } : {}) },
    payload: body,
  });
}

/** Pays the order by FPX through the API, so it carries a CHIP purchase; returns that purchase. */
async function startPayment(on: FastifyInstance, shop: Shop) {
  const purchase = aPurchase();
  client.createPurchase.mockResolvedValueOnce(purchase);
  const res = await pay(on, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' });
  expect(res.statusCode).toBe(200);
  return purchase;
}

describe('GET /store/:handle/pay-methods', () => {
  it('checkout offers FPX, e-wallet and card when connected, at the order total, asked once in a while', async () => {
    const shop = await aShopWithOrder(app);
    client.listPaymentMethods.mockResolvedValue([...ALL_METHODS, 'boost']);

    const res = await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fpx: true, wallets: ['tng', 'grab', 'spay'], card: true });
    expect(clientFor).toHaveBeenCalledWith({ secretKey: SECRET, brandId: shop.brandId });
    expect(client.listPaymentMethods).toHaveBeenCalledWith(22_000);

    await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
    expect(client.listPaymentMethods).toHaveBeenCalledTimes(1);
  });

  it('offers nothing online, without asking CHIP, when the shop is not connected or cannot take payment', async () => {
    const none = { fpx: false, wallets: [], card: false };
    const unconnected = await aShopWithOrder(app, { connected: false });
    const refused = await aShopWithOrder(app, { lastErrorAt: new Date() });
    const testKey = await aShopWithOrder(live, { isTest: true });

    for (const [on, shop] of [[app, unconnected], [app, refused], [live, testKey]] as const) {
      const res = await on.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
      expect(res.json()).toEqual(none);
    }
    expect(client.listPaymentMethods).not.toHaveBeenCalled();
  });

  it('offers nothing online when CHIP cannot be asked', async () => {
    const shop = await aShopWithOrder(app);
    client.listPaymentMethods.mockRejectedValueOnce(new ChipUnavailableError('down'));
    const res = await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
    expect(res.json()).toEqual({ fpx: false, wallets: [], card: false });
  });
});

describe('POST /store/orders/:token/pay', () => {
  it("creates the purchase on the owner's brand with the owner's key and answers the pay URL for Maybank2u", async () => {
    const shop = await aShopWithOrder(app);
    const purchase = aPurchase();
    client.createPurchase.mockResolvedValueOnce(purchase);
    const before = Date.now();

    const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: ' aisyah@example.com ' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://gate.chip-in.asia/p/order-purchase/?preferred=fpx&fpx_bank_code=MB2U0227' });
    expect(clientFor).toHaveBeenCalledWith({ secretKey: SECRET, brandId: shop.brandId });
    const input = client.createPurchase.mock.calls[0]![0];
    expect(input).toMatchObject({
      email: 'aisyah@example.com',
      fullName: 'Aisyah',
      phone: '+60 123456789',
      reference: '1',
      notes: 'FPX · Maybank2u',
      successCallback: `${CALLBACK_BASE}/store/chip/callback/${shop.orderId}`,
      redirectUrl: `${APP_URL}/${shop.handle}/order/${shop.token}`,
      sendReceipt: true,
      cardsOnlyRecurring: false,
      products: [
        { name: 'Kek coklat moist (2kg)', priceCents: 17_000, quantity: 1 },
        { name: 'Tart nenas', priceCents: 2_000, quantity: 2 },
        { name: 'Delivery', priceCents: 1_000, quantity: 1 },
      ],
    });
    // Never CHIP's own DuitNow QR: the owner's QR is the only QR option.
    expect(input.methods).toEqual(['fpx', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'visa', 'mastercard', 'maestro']);
    expect(input.dueAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(input.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);

    // Placed as it was; only the purchase and the email are added.
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', chipPurchaseId: purchase.id, payerEmail: 'aisyah@example.com', paidAt: null });
  });

  it('sends e-wallets to the wallet and card to CHIP’s card page', async () => {
    const tng = await aShopWithOrder(app);
    expect((await pay(app, tng.token, { method: 'tng', email: 'a@example.com' })).json().url).toBe(
      'https://gate.chip-in.asia/p/order-purchase/?preferred=razer_tng&razer_bank_code=TNG-EWALLET',
    );
    const card = await aShopWithOrder(app);
    expect((await pay(app, card.token, { method: 'card', email: 'a@example.com' })).json().url).toBe('https://gate.chip-in.asia/p/order-purchase/?preferred=visa');
  });

  it('uses the order’s own email when none is sent, and asks when it has none', async () => {
    const withEmail = await aShopWithOrder(app);
    await app.prisma.order.update({ where: { id: withEmail.orderId }, data: { email: 'buyer@example.com' } });
    const res = await pay(app, withEmail.token, { method: 'card' });
    expect(res.statusCode).toBe(200);
    expect(client.createPurchase.mock.calls.at(-1)![0]).toMatchObject({ email: 'buyer@example.com' });
    expect(await orderOf(app, withEmail.orderId)).toMatchObject({ payerEmail: 'buyer@example.com' });
    const without = await aShopWithOrder(app);
    const refused = await pay(app, without.token, { method: 'card' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('EMAIL_REQUIRED');
  });

  it('an online choice asks for an email', async () => {
    const shop = await aShopWithOrder(app);
    for (const payload of [{ method: 'card' }, { method: 'card', email: '' }, { method: 'card', email: 'not-an-email' }]) {
      expect((await pay(app, shop.token, payload)).statusCode).toBe(400);
    }
    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it('a second attempt cancels the purchase before it and replaces it', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'viewed' });
    const second = aPurchase();
    client.createPurchase.mockResolvedValueOnce(second);

    const res = await pay(app, shop.token, { method: 'card', email: 'b@example.com' });

    expect(res.json().url).toContain('preferred=visa');
    expect(client.cancelPurchase).toHaveBeenCalledWith(first.id);
    expect(await orderOf(app, shop.orderId)).toMatchObject({ chipPurchaseId: second.id, payerEmail: 'b@example.com' });
  });

  it('refuses to start a payment for a suspended page with 410, makes no purchase, and works again once it is back', async () => {
    const shop = await aShopWithOrder(app);
    await app.prisma.page.update({ where: { id: shop.pageId }, data: { suspendedAt: new Date(), suspendReason: 'x' } });

    const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' });

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('PAGE_UNAVAILABLE');
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', chipPurchaseId: null });

    const methods = await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
    expect(methods.json()).toEqual({ fpx: false, wallets: [], card: false });

    await app.prisma.page.update({ where: { id: shop.pageId }, data: { suspendedAt: null, suspendReason: null } });
    await startPayment(app, shop);
  });

  it('refuses to start a payment once a receipt is sent, and makes no purchase', async () => {
    const shop = await aShopWithOrder(app);
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { receiptKey: `receipts/${shop.pageId}/r.png`, receiptType: 'image/png', receiptUploadedAt: new Date() } });

    const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ORDER_RECEIPT_SENT', message: "Your receipt is with Kek Lina to check. They'll confirm it soon." });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', chipPurchaseId: null, receiptKey: `receipts/${shop.pageId}/r.png` });
  });

  it('a second attempt after the first was paid marks the order paid instead of charging again', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });

    const res = await pay(app, shop.token, { method: 'card', email: 'b@example.com' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ORDER_ALREADY_PAID');
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP', chipPurchaseId: first.id });
  });

  describe('a CHIP failure when paying falls back to the QR with a message', () => {
    it('when CHIP is down, the order stays placed and checkout is told to show the QR', async () => {
      const shop = await aShopWithOrder(app);
      client.createPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));

      const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'a@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ url: null });
      expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', chipPurchaseId: null });
      expect((await accountOf(app, shop.pageId)).lastErrorAt).toBeNull();
    });

    it('when CHIP refuses the key, which is marked', async () => {
      const shop = await aShopWithOrder(app);
      client.createPurchase.mockRejectedValueOnce(new ChipRefusedError('CHIP refused POST /purchases/ with 401: {"secret": "body"}', 401));

      expect((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect((await accountOf(app, shop.pageId)).lastErrorAt).toBeInstanceOf(Date);
    });

    it('when the key cannot be opened after PAYMENT_SECRETS_KEY changed, which is marked', async () => {
      const shop = await aShopWithOrder(app, { sealedWith: randomBytes(32) });

      expect((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect(client.createPurchase).not.toHaveBeenCalled();
      expect((await accountOf(app, shop.pageId)).lastErrorAt).toBeInstanceOf(Date);
    });

    it('when the shop is not connected, a key was refused before, or the method is not offered', async () => {
      const unconnected = await aShopWithOrder(app, { connected: false });
      const refused = await aShopWithOrder(app, { lastErrorAt: new Date() });
      expect((await pay(app, unconnected.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect((await pay(app, refused.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });

      const noWallet = await aShopWithOrder(app);
      client.listPaymentMethods.mockResolvedValueOnce(['fpx']);
      expect((await pay(app, noWallet.token, { method: 'grab', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect(client.createPurchase).not.toHaveBeenCalled();
    });

    it('in production, a test account takes no payment, and a test purchase is cancelled', async () => {
      const testAccount = await aShopWithOrder(live, { isTest: true });
      expect((await pay(live, testAccount.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect(client.createPurchase).not.toHaveBeenCalled();

      const shop = await aShopWithOrder(live);
      const testPurchase = aPurchase({ isTest: true });
      client.createPurchase.mockResolvedValueOnce(testPurchase);
      expect((await pay(live, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect(client.cancelPurchase).toHaveBeenCalledWith(testPurchase.id);
      expect(await orderOf(live, shop.orderId)).toMatchObject({ chipPurchaseId: null });
      expect(await accountOf(live, shop.pageId)).toMatchObject({ isTest: true, lastErrorAt: expect.any(Date) });
    });

    it('when the lines do not add up to the total, no purchase is made', async () => {
      const shop = await aShopWithOrder(app);
      await app.prisma.order.update({ where: { id: shop.orderId }, data: { totalCents: 99_999 } });
      expect((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
      expect(client.createPurchase).not.toHaveBeenCalled();
    });
  });

  it('refuses a paid or cancelled order, and an unknown link', async () => {
    const paid = await aShopWithOrder(app);
    await app.prisma.order.update({ where: { id: paid.orderId }, data: { status: 'PAID', paidAt: new Date() } });
    expect((await pay(app, paid.token, { method: 'card', email: 'a@example.com' })).json().error.code).toBe('ORDER_ALREADY_PAID');
    const cancelled = await aShopWithOrder(app);
    await app.prisma.order.update({ where: { id: cancelled.orderId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    expect((await pay(app, cancelled.token, { method: 'card', email: 'a@example.com' })).json().error.code).toBe('ORDER_CANCELLED');
    expect((await pay(app, 'no-such-token', { method: 'card', email: 'a@example.com' })).statusCode).toBe(404);
  });
});

describe('POST /store/chip/callback/:orderId', () => {
  it("a callback signed with Curios's key, another shop's key, or unsigned changes nothing", async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid' });

    for (const key of [curiosKey.privateKey, otherShopKey.privateKey, null]) {
      const res = await callback(app, shop.orderId, purchase.id, key);
      expect(res.statusCode).toBe(400);
    }
    expect(client.getPurchase).not.toHaveBeenCalled();
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', paidAt: null, paidVia: null });
  });

  it('a verified callback marks the order paid once', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u', referenceGenerated: 'CH0042' });
    clientFor.mockClear();

    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'paid' });
    // Fetched with that owner's own key, by the id the order holds.
    expect(clientFor).toHaveBeenCalledWith({ secretKey: SECRET, brandId: shop.brandId });
    expect(client.getPurchase).toHaveBeenCalledWith(purchase.id);
    const order = await orderOf(app, shop.orderId);
    expect(order).toMatchObject({
      status: 'PAID',
      paidVia: 'CHIP',
      paidAt: expect.any(Date),
      paidMethodLabel: 'FPX · Maybank2u',
      paidRef: 'CH0042',
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
    });
    expect(store.remove).not.toHaveBeenCalled();

    const again = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'already-paid' });
    expect((await orderOf(app, shop.orderId)).paidAt).toEqual(order.paidAt);
    // One paid email, for the first settle only: the repeat mails nothing (the new-order email is placement's).
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('believes nothing in the body but the id: CHIP must say paid, with this order’s number, total and purchase', async () => {
    const cases: [string, Partial<ChipPurchase>][] = [
      ['not paid', { status: 'pending_execute' }],
      ['another reference', { status: 'paid', reference: '2' }],
      ['another total', { status: 'paid', totalCents: 100 }],
      ['another currency', { status: 'paid', currency: 'USD' }],
    ];
    for (const [, change] of cases) {
      const shop = await aShopWithOrder(app);
      const purchase = await startPayment(app, shop);
      client.getPurchase.mockResolvedValueOnce({ ...purchase, ...change });
      const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
      expect(res.statusCode).toBe(200);
      expect((await orderOf(app, shop.orderId)).status).toBe('PLACED');
    }

    // A signed message about some other purchase is not even looked up.
    const shop = await aShopWithOrder(app);
    await startPayment(app, shop);
    client.getPurchase.mockClear();
    const res = await callback(app, shop.orderId, 'purchase-not-this-order', ownerKey.privateKey);
    expect(res.json()).toEqual({ status: 'ignored' });
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('in production, a test purchase never marks an order paid', async () => {
    const shop = await aShopWithOrder(live);
    const purchase = await startPayment(live, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', isTest: true });

    const res = await callback(live, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(res.statusCode).toBe(200);
    expect((await orderOf(live, shop.orderId)).status).toBe('PLACED');
  });

  it('ignores an unknown order or a shop with no CHIP account, and fails loudly when CHIP cannot be asked', async () => {
    expect((await callback(app, 'no-such-order', 'p', ownerKey.privateKey)).json()).toEqual({ status: 'ignored' });
    const unconnected = await aShopWithOrder(app, { connected: false });
    expect((await callback(app, unconnected.orderId, 'p', ownerKey.privateKey)).json()).toEqual({ status: 'ignored' });

    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).statusCode).toBe(500);
    expect((await orderOf(app, shop.orderId)).status).toBe('PLACED');
  });
});

describe('GET /store/orders/:token/pay-status', () => {
  it('the order page shows Paid after a callback even if the customer never came back', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'razer_tng' });
    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'paid' });
    client.getPurchase.mockClear();

    const res = await payStatus(app, shop.token);

    expect(res.statusCode).toBe(200);
    // CHIP gave no reference of its own, so none is shown: never the purchase id.
    expect(res.json()).toEqual({ state: 'paid', paidAt: expect.any(String), paidMethodLabel: 'Touch ’n Go eWallet', paidRef: null });
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('marks the order paid itself when the callback never came', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'visa', maskedPan: '424242******4242' });

    const res = await payStatus(app, shop.token);

    expect(res.json()).toMatchObject({ state: 'paid', paidMethodLabel: 'Visa card ending 4242' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP' });
  });

  it('says pending while the bank has not answered, failed for a purchase nobody will pay, and none without one', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'pending_execute' });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'pending' });
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'unknown' });
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'cancelled' });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'failed' });

    const plain = await aShopWithOrder(app);
    expect((await payStatus(app, plain.token)).json()).toEqual({ state: 'none' });
    expect((await payStatus(app, 'no-such-token')).statusCode).toBe(404);
  });
});

describe('fix round 1: a second try never orphans a paid purchase', () => {
  it('makes no new purchase when the earlier one cannot be looked up', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));

    expect((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
    expect((await orderOf(app, shop.orderId)).chipPurchaseId).toBe(first.id);
  });

  it('settles the earlier purchase and refuses, when it cannot be cancelled because it was paid', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'viewed' }).mockResolvedValueOnce({ ...first, status: 'paid', paymentMethod: 'fpx' });
    client.cancelPurchase.mockRejectedValueOnce(new ChipRefusedError('paid', 400));

    const res = await pay(app, shop.token, { method: 'card', email: 'a@example.com' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ORDER_ALREADY_PAID');
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP' });
  });

  it('makes no new purchase when the earlier one cannot be cancelled and is not paid', async () => {
    const shop = await aShopWithOrder(app);
    await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...aPurchase(), status: 'viewed' });
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));

    expect((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).json()).toEqual({ url: null });
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
  });

  it('two tries at once: one purchase is kept, the other cancelled', async () => {
    const shop = await aShopWithOrder(app);
    const one = aPurchase();
    const two = aPurchase();
    // Slow enough at CHIP that both tries have read the order before either keeps its purchase.
    const slow = (purchase: ChipPurchase) => () => new Promise<ChipPurchase>((resolve) => setTimeout(() => resolve(purchase), 150));
    client.createPurchase.mockImplementationOnce(slow(one)).mockImplementationOnce(slow(two));

    const answers = await Promise.all([
      pay(app, shop.token, { method: 'card', email: 'a@example.com' }),
      pay(app, shop.token, { method: 'card', email: 'a@example.com' }),
    ]);

    const kept = (await orderOf(app, shop.orderId)).chipPurchaseId;
    expect([one.id, two.id]).toContain(kept);
    const lost = kept === one.id ? two.id : one.id;
    expect(client.cancelPurchase).toHaveBeenCalledWith(lost);
    expect(answers.filter((res) => res.json().url !== null)).toHaveLength(1);
  });

  it('keeps when the purchase stops being payable', async () => {
    const shop = await aShopWithOrder(app);
    const before = Date.now();
    await startPayment(app, shop);
    const due = (await orderOf(app, shop.orderId)).chipPurchaseDueAt!.getTime();
    expect(due).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(due).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
  });
});

describe('fix round 1: the order page never strands a customer', () => {
  it('says unknown, not pending, when it cannot ask CHIP', async () => {
    const shop = await aShopWithOrder(app);
    await startPayment(app, shop);
    await app.prisma.shopPaymentAccount.delete({ where: { pageId: shop.pageId } });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'unknown' });

    const sealedElsewhere = await aShopWithOrder(app);
    await startPayment(app, sealedElsewhere);
    await app.prisma.shopPaymentAccount.update({ where: { pageId: sealedElsewhere.pageId }, data: { secretKeyCiphertext: sealSecret(SECRET, randomBytes(32)) } });
    expect((await payStatus(app, sealedElsewhere.token)).json()).toEqual({ state: 'unknown' });
  });

  it('a key CHIP refuses while the order page checks is marked, so the owner is told', async () => {
    const shop = await aShopWithOrder(app);
    await startPayment(app, shop);
    client.getPurchase.mockRejectedValueOnce(new ChipRefusedError('CHIP refused GET with 401: {"secret": "body"}', 401));

    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'unknown' });
    expect((await accountOf(app, shop.pageId)).lastErrorAt).toBeInstanceOf(Date);
  });

  it('a purchase past its due time that is not paid has failed', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { chipPurchaseDueAt: new Date(Date.now() - 60_000) } });
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'viewed' });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'failed' });
  });
});

describe('fix round 1: budgets', () => {
  it('asks CHIP about one order at most once every few seconds, answering the last state meanwhile', async () => {
    const shop = await aShopWithOrder(throttled);
    const purchase = await startPayment(throttled, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'viewed' });

    for (let i = 0; i < 3; i++) expect((await payStatus(throttled, shop.token)).json()).toEqual({ state: 'pending' });
    expect(client.getPurchase).toHaveBeenCalledTimes(1);
  });

  it("the order page's checks have their own budget per order, apart from paying's per-visitor one", async () => {
    const shop = await aShopWithOrder(app);
    const ip = from();
    for (let i = 0; i < 70; i++) {
      const res = await app.inject({ method: 'GET', url: `/store/orders/${shop.token}/pay-status`, remoteAddress: ip });
      expect(res.statusCode).toBe(200);
    }
  });

  it("one shop's checkouts asking what it takes never spend the budget for paying, or for asking another shop", async () => {
    const busy = await aShopWithOrder(app);
    const other = await aShopWithOrder(app);
    // One address for many customers (a carrier's NAT), all on the busy shop's checkout.
    const ip = from();
    const ask = (handle: string) => app.inject({ method: 'GET', url: `/store/${handle}/pay-methods?amount=22000`, remoteAddress: ip });
    for (let i = 0; i < 60; i++) expect((await ask(busy.handle)).statusCode).toBe(200);
    expect((await ask(busy.handle)).statusCode).toBe(429);

    expect((await ask(other.handle)).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: `/store/orders/${busy.token}/pay`, remoteAddress: ip, payload: { method: 'card', email: 'a@example.com' } });
    expect(res.statusCode).toBe(200);
  });

  it('paying is limited per order as well as per visitor', async () => {
    const shop = await aShopWithOrder(app);
    client.createPurchase.mockImplementation(async () => aPurchase());
    client.getPurchase.mockImplementation(async (id) => ({ ...aPurchase(), id, status: 'viewed' }));
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await pay(app, shop.token, { method: 'card', email: 'a@example.com' })).statusCode);
    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('fix round 1: the owner cancels an order being paid online', () => {
  const cancel = async (on: FastifyInstance, shop: Shop) =>
    on.inject({ method: 'POST', url: `/orders/${shop.orderId}/cancel`, cookies: { [SESSION_COOKIE]: (await createSession(on.prisma, shop.accountId)).value }, payload: {} });

  it("cancels CHIP's purchase first, with the owner's key", async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);

    expect((await cancel(app, shop)).statusCode).toBe(204);
    expect(client.cancelPurchase).toHaveBeenCalledWith(purchase.id);
    expect((await orderOf(app, shop.orderId)).status).toBe('CANCELLED');
  });

  it('refuses, and marks it paid, when it was just paid online', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipRefusedError('paid', 400));
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'fpx' });

    const res = await cancel(app, shop);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ORDER_JUST_PAID', message: 'This order was just paid online.' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP' });
  });

  it('a payment that lands after the cancel is recorded on the cancelled order, so a refund is owed', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await cancel(app, shop)).statusCode).toBe(204);

    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'visa', maskedPan: '4242' });
    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(res.json()).toEqual({ status: 'paid-after-cancel' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'CANCELLED', paidVia: 'CHIP', paidAt: expect.any(Date), paidMethodLabel: 'Visa card ending 4242', refundedAt: null });
  });

  it('a payment that lands after the cancel does not take the voucher’s use back: the order lets go of it, keeping its record', async () => {
    const shop = await aShopWithOrder(app);
    const voucher = await app.prisma.shopVoucher.create({ data: { pageId: shop.pageId, mode: 'CODE', code: 'RAYA10', kind: 'AMOUNT', amountCents: 1_000, maxUses: 1 } });
    const purchase = await startPayment(app, shop);
    // The order took the voucher when it was placed (set here, after paying started, so CHIP's purchase keeps the fixture's total).
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { voucherId: voucher.id, voucherLabel: 'RAYA10', discountCents: 1_000 } });
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await cancel(app, shop)).statusCode).toBe(204);

    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'visa', maskedPan: '4242' });
    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'paid-after-cancel' });

    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'CANCELLED', paidAt: expect.any(Date), voucherId: null, voucherLabel: 'RAYA10', discountCents: 1_000 });
    // Cancelled before it was paid gave the use back; the late payment does not count it again.
    expect(await app.prisma.order.count({ where: { voucherId: voucher.id, ...COUNTED_ORDER_WHERE } })).toBe(0);
  });

  it('the owner is emailed once that the order is paid, not told to wait for a receipt', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u', referenceGenerated: 'CH0042' });
    mailQueue.add.mockClear();

    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    await payStatus(app, shop.token);

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe('mail');
    // An owner's notification: the admin's "Emails to owners" switch stops it.
    expect(data).toMatchObject({ subject: 'New order #1 · RM220 · Paid', audience: 'owner' });
    expect(data.to).toMatch(/^pay-.*@example\.com$/);
    expect(data.html).toContain('Aisyah ordered and paid RM220');
    expect(data.html).toContain('FPX · Maybank2u · Ref CH0042');
    expect(data.html).toContain(`/app/orders?order=${shop.orderId}`);
    expect(data.html).not.toContain('Waiting for payment');
    expect(opts).toMatchObject({ attempts: 5 });
  });

  it('the order page settling the payment sends the same single email', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });
    mailQueue.add.mockClear();

    await payStatus(app, shop.token);
    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    expect(mailQueue.add.mock.calls[0]![1].subject).toBe('New order #1 · RM220 · Paid');
  });

  it('no email when the owner switched order emails off, and none for a payment that did not settle', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    mailQueue.add.mockClear();
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'pending_execute' });
    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(mailQueue.add).not.toHaveBeenCalled();

    await app.prisma.page.update({ where: { id: shop.pageId }, data: { notifyOrders: false } });
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx' });
    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(res.json()).toEqual({ status: 'paid' });
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('a mail that cannot be queued never breaks the callback', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx' });
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));

    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'paid' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP' });

    // And a queue that throws on the spot, rather than rejects.
    const second = await aShopWithOrder(app);
    const p2 = await startPayment(app, second);
    client.getPurchase.mockResolvedValue({ ...p2, status: 'paid', paymentMethod: 'fpx' });
    mailQueue.add.mockImplementationOnce(() => {
      throw new Error('queue closed');
    });
    const again = await callback(app, second.orderId, p2.id, ownerKey.privateKey);
    expect(again.json()).toEqual({ status: 'paid' });
  });

  it('a payment after the cancel tells the owner to refund it in CHIP', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await cancel(app, shop)).statusCode).toBe(204);
    mailQueue.add.mockClear();

    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });
    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const data = mailQueue.add.mock.calls[0]![1];
    expect(data.subject).toBe('Order #1 was paid after you cancelled it');
    expect(data.text).toContain('Aisyah paid RM220 by FPX · Maybank2u after you cancelled it. Refund them in CHIP, then mark it refunded in Orders.');
  });
});

describe('final review: paid-family statuses', () => {
  const cancel = async (on: FastifyInstance, shop: Shop) =>
    on.inject({ method: 'POST', url: `/orders/${shop.orderId}/cancel`, cookies: { [SESSION_COOKIE]: (await createSession(on.prisma, shop.accountId)).value }, payload: {} });

  it('a purchase CHIP says is settled, with no callback, is settled PAID by the order page', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'settled', paymentMethod: 'visa', maskedPan: '424242******4242' });

    expect((await payStatus(app, shop.token)).json()).toMatchObject({ state: 'paid', paidMethodLabel: 'Visa card ending 4242' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP' });
  });

  it('a cleared purchase past its due time is paid, never failed', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { chipPurchaseDueAt: new Date(Date.now() - 60_000) } });
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'cleared', paymentMethod: 'fpx' });

    expect((await payStatus(app, shop.token)).json()).toMatchObject({ state: 'paid' });
  });

  it('a callback for a cleared purchase marks the order paid', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'cleared', paymentMethod: 'fpx' });

    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'paid' });
  });

  it('cancelling an order whose purchase is settled is refused and the order settled, never a plain cancel', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipRefusedError('settled', 400));
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'settled', paymentMethod: 'fpx' });

    const res = await cancel(app, shop);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ORDER_JUST_PAID');
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP', cancelledAt: null });
  });

  it('a second attempt over a refunded purchase makes no new one: the money was taken once already', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'refunded', paymentMethod: 'fpx' });

    const res = await pay(app, shop.token, { method: 'card', email: 'b@example.com' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ORDER_ALREADY_PAID');
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
  });

  it('an overdue purchase has failed on the order page, and is still cancelled before a new one is made', async () => {
    const shop = await aShopWithOrder(app);
    const first = await startPayment(app, shop);
    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'overdue' });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'failed' });

    client.getPurchase.mockResolvedValueOnce({ ...first, status: 'overdue' });
    const res = await pay(app, shop.token, { method: 'card', email: 'b@example.com' });
    expect(res.json().url).toContain('preferred=visa');
    expect(client.cancelPurchase).toHaveBeenCalledWith(first.id);
  });
});

describe('final review: a second payment is never invisible', () => {
  const markPaid = async (on: FastifyInstance, shop: Shop) =>
    on.inject({ method: 'POST', url: `/orders/${shop.orderId}/paid`, cookies: { [SESSION_COOKIE]: (await createSession(on.prisma, shop.accountId)).value }, payload: {} });

  it('an order paid by QR that CHIP then takes a payment for is recorded as paid twice, and the owner told once', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    const paidAt = new Date('2026-10-20T03:00:00Z');
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { status: 'PAID', paidAt, paidVia: 'RECEIPT' } });
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });
    mailQueue.add.mockClear();

    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(res.json()).toEqual({ status: 'paid-twice' });
    const again = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(again.json()).toEqual({ status: 'already-paid' });

    const order = await orderOf(app, shop.orderId);
    // The first payment stands as it was; the second is recorded beside it.
    expect(order).toMatchObject({ status: 'PAID', paidVia: 'RECEIPT', paidAt, paidMethodLabel: null, chipPaidTwiceAt: expect.any(Date) });
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const data = mailQueue.add.mock.calls[0]![1];
    expect(data.subject).toBe('Order #1 was paid twice');
    expect(data.text).toContain('Aisyah paid RM220 by FPX · Maybank2u on top of the QR payment. Refund one of them in CHIP.');
    expect(data.text).toContain(`Open order #1: ${APP_URL}/app/orders?order=${shop.orderId}`);
  });

  it('a payment that settles on an order with a receipt keeps the receipt and records the second payment, telling the owner once', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    const receiptKey = `receipts/${shop.pageId}/r.png`;
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { receiptKey, receiptType: 'image/png', receiptUploadedAt: new Date() } });
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });
    mailQueue.add.mockClear();

    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(res.json()).toEqual({ status: 'paid-twice' });
    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'already-paid' });

    expect(await orderOf(app, shop.orderId)).toMatchObject({
      status: 'PAID',
      paidVia: 'CHIP',
      receiptKey,
      receiptType: 'image/png',
      receiptUploadedAt: expect.any(Date),
      chipPaidTwiceAt: expect.any(Date),
    });
    expect(store.remove).not.toHaveBeenCalled();
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const data = mailQueue.add.mock.calls[0]![1];
    expect(data.subject).toBe('Order #1 was paid twice');
    expect(data.text).toContain('on top of the QR payment.');
  });

  it('says hand-marked for an order the owner marked paid by hand', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { status: 'COMPLETED', paidAt: new Date(), completedAt: new Date(), paidVia: 'MANUAL' } });
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });
    mailQueue.add.mockClear();

    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'paid-twice' });
    expect(mailQueue.add.mock.calls[0]![1].text).toContain('on top of the hand-marked payment.');
  });

  it("marking paid by hand cancels CHIP's purchase first, with the owner's key", async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);

    expect((await markPaid(app, shop)).statusCode).toBe(204);
    expect(client.cancelPurchase).toHaveBeenCalledWith(purchase.id);
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'MANUAL' });
  });

  it('marking paid when CHIP was just paid settles it as CHIP and tells the owner', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipRefusedError('paid', 400));
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });

    const res = await markPaid(app, shop);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ORDER_JUST_PAID', message: 'This order was just paid online.' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP', paidMethodLabel: 'FPX · Maybank2u', chipPaidTwiceAt: null });
  });

  it('marking paid goes ahead when CHIP cannot be asked; a payment that lands later is recorded as paid twice', async () => {
    const shop = await aShopWithOrder(app);
    const purchase = await startPayment(app, shop);
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    client.getPurchase.mockRejectedValueOnce(new ChipUnavailableError('down'));
    expect((await markPaid(app, shop)).statusCode).toBe(204);

    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'paid', paymentMethod: 'fpx' });
    expect((await callback(app, shop.orderId, purchase.id, ownerKey.privateKey)).json()).toEqual({ status: 'paid-twice' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'MANUAL', chipPaidTwiceAt: expect.any(Date) });
  });
});

describe('the CHIP payments switch', () => {
  /** The switch as the admin's route stores it, then the cache cleared, as that route does. */
  async function paymentsSwitch(on: boolean) {
    await app.prisma.systemSetting.upsert({ where: { key: 'switch.chipPayments' }, create: { key: 'switch.chipPayments', value: on }, update: { value: on } });
    app.settings.clear();
  }

  it('off: checkout is offered nothing online and paying is a 503 PAYMENTS_OFF, with no purchase made; on again, both work', async () => {
    const shop = await aShopWithOrder(app);
    client.listPaymentMethods.mockResolvedValue(ALL_METHODS);
    client.createPurchase.mockResolvedValue(aPurchase());
    await paymentsSwitch(false);
    try {
      const methods = await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
      expect(methods.json()).toEqual({ fpx: false, wallets: [], card: false });
      const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toEqual({ code: 'PAYMENTS_OFF', message: 'Online payments are paused for a moment. Try again soon.' });
      expect(client.createPurchase).not.toHaveBeenCalled();
      expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PLACED', chipPurchaseId: null });
    } finally {
      await paymentsSwitch(true);
    }
    const methods = await app.inject({ method: 'GET', url: `/store/${shop.handle}/pay-methods?amount=22000`, remoteAddress: from() });
    expect(methods.json()).toEqual({ fpx: true, wallets: ['tng', 'grab', 'spay'], card: true });
    expect((await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' })).statusCode).toBe(200);
  });
});

describe('an order with a voucher, paid online', () => {
  /** The RM220 order with RAYA10 taking RM21 off its items: RM199 to pay. */
  async function aDiscountedOrder() {
    const shop = await aShopWithOrder(app);
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { discountCents: 2_100, voucherLabel: 'RAYA10', totalCents: 19_900 } });
    return shop;
  }

  it("CHIP's purchase is the discounted total, and its products add up to it", async () => {
    const shop = await aDiscountedOrder();
    client.createPurchase.mockResolvedValueOnce(aPurchase({ totalCents: 19_900 }));

    const res = await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).not.toBeNull();
    expect(client.listPaymentMethods).toHaveBeenCalledWith(19_900);
    const input = client.createPurchase.mock.calls[0]![0];
    expect(input.amountCents).toBe(19_900);
    expect((input.products ?? []).reduce((sum, p) => sum + p.priceCents * p.quantity, 0)).toBe(19_900);
    // Delivery is never discounted, so it stays its own line.
    expect(input.products).toContainEqual({ name: 'Delivery', priceCents: 1_000, quantity: 1 });
    expect((input.products ?? []).some((p) => p.name.includes('RAYA10'))).toBe(true);
  });

  it('settling that purchase marks the order paid, and the owner sees the voucher', async () => {
    const shop = await aDiscountedOrder();
    const purchase = aPurchase({ totalCents: 19_900 });
    client.createPurchase.mockResolvedValueOnce(purchase);
    expect((await pay(app, shop.token, { method: 'fpx', bank: 'maybank', email: 'aisyah@example.com' })).statusCode).toBe(200);
    client.getPurchase.mockResolvedValue({ ...purchase, status: 'paid', paymentMethod: 'fpx', notes: 'FPX · Maybank2u' });

    const res = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);

    expect(res.json()).toEqual({ status: 'paid' });
    expect(await orderOf(app, shop.orderId)).toMatchObject({ status: 'PAID', paidVia: 'CHIP', totalCents: 19_900 });
    await vi.waitFor(() => expect(mailQueue.add).toHaveBeenCalledTimes(1));
    const mail = mailQueue.add.mock.calls[0]![1];
    expect(mail.text).toContain('RAYA10: −RM21');
    expect(mail.text).toContain('Paid: RM199');
  });
});

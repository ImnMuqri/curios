import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChipRefusedError, ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { hashSessionValue, type MailJobData } from '@curios/core';
import { sealSecret } from '@curios/core/secret-box';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';

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
let nth = 0;
const from = () => `203.0.121.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: false, callbackBaseUrl: CALLBACK_BASE }, orders: { mailQueue, store } });
  live = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: true, callbackBaseUrl: CALLBACK_BASE }, orders: { mailQueue, store } });
  await Promise.all([app.ready(), live.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), live.close()]);
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
    select: { pages: { select: { id: true } } },
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
  return { handle: slug, pageId, brandId, token, orderId: order.id };
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
    await app.prisma.order.update({ where: { id: shop.orderId }, data: { receiptKey: `receipts/${shop.pageId}/r.png`, receiptType: 'image/png', receiptUploadedAt: new Date() } });
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
    expect(store.remove).toHaveBeenCalledWith(`receipts/${shop.pageId}/r.png`);

    const again = await callback(app, shop.orderId, purchase.id, ownerKey.privateKey);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'already-paid' });
    expect((await orderOf(app, shop.orderId)).paidAt).toEqual(order.paidAt);
    // The paid email is Task 14's: nothing is mailed here, and the new-order email is not sent again.
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('believes nothing in the body but the id: CHIP must say paid, with this order’s number, total and purchase', async () => {
    const cases: [string, Partial<ChipPurchase>][] = [
      ['not paid', { status: 'pending_execute' }],
      ['another reference', { status: 'paid', reference: '2' }],
      ['another total', { status: 'paid', totalCents: 100 }],
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
    expect(res.json()).toEqual({ state: 'paid', paidAt: expect.any(String), paidMethodLabel: 'Touch ’n Go eWallet', paidRef: purchase.id });
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
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'pending' });
    client.getPurchase.mockResolvedValueOnce({ ...purchase, status: 'cancelled' });
    expect((await payStatus(app, shop.token)).json()).toEqual({ state: 'failed' });

    const plain = await aShopWithOrder(app);
    expect((await payStatus(app, plain.token)).json()).toEqual({ state: 'none' });
    expect((await payStatus(app, 'no-such-token')).statusCode).toBe(404);
  });
});

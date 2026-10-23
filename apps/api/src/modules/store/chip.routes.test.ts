import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChipRefusedError, ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { openSecret } from '@curios/core/secret-box';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

const SECRETS_KEY = randomBytes(32);
const SECRET = 'owner-chip-secret-key-0123456789abcdefghij';
const BRAND = '0b7f3c4e-1a2b-4c5d-8e9f-0a1b2c3d4e5f';
const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----';

const client = {
  createPurchase: vi.fn<ChipClient['createPurchase']>(),
  getPurchase: vi.fn<ChipClient['getPurchase']>(),
  chargePurchase: vi.fn<ChipClient['chargePurchase']>(),
  deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
  cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
  getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
  listPaymentMethods: vi.fn<ChipClient['listPaymentMethods']>(),
};
/** Which owner's key and brand each client was built with. */
const clientFor = vi.fn((_credentials: { secretKey: string; brandId: string }): ChipClient => client);

let app: FastifyInstance;
let live: FastifyInstance;
let unconfigured: FastifyInstance;
let nth = 0;
const from = () => `203.0.119.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: false } });
  live = await buildApp({ shopChip: { clientFor, secretsKey: SECRETS_KEY, production: true } });
  unconfigured = await buildApp({ shopChip: { clientFor, secretsKey: null, production: false } });
  await Promise.all([app.ready(), live.ready(), unconfigured.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), live.close(), unconfigured.close()]);
});

function aPurchase(overrides: Partial<ChipPurchase> = {}): ChipPurchase {
  return {
    id: `purchase-${randomUUID()}`,
    status: 'created',
    reference: 'Curios test',
    totalCents: 100,
    checkoutUrl: 'https://gate.chip-in.asia/p/test-purchase/',
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
  client.listPaymentMethods.mockResolvedValue(['fpx', 'visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'duitnow_qr']);
  client.getPublicKey.mockResolvedValue(PEM);
  client.createPurchase.mockResolvedValue(aPurchase({ brandName: 'Kek Lina Bakes' }));
  client.cancelPurchase.mockResolvedValue(undefined);
});

async function anOwner(on: FastifyInstance, mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const slug = randomUUID().slice(0, 8);
  const email = `chip-${randomUUID()}@example.com`;
  const account = await on.prisma.account.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ch-${slug}`, skeleton: `ch-${slug}`, displayName: 'Kek Lina', mode, pickupEnabled: true } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { email, cookie: (await createSession(on.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}

const call = (on: FastifyInstance, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  on.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const connect = (on: FastifyInstance, cookie: string, payload: object = { brandId: BRAND, secretKey: SECRET }) => call(on, 'POST', '/store/chip', cookie, payload);
const account = (on: FastifyInstance, pageId: string) => on.prisma.shopPaymentAccount.findUnique({ where: { pageId } });

/** A placed order on the page with a CHIP purchase payable until `due`. */
const aPayingOrder = (pageId: string, due: Date) =>
  app.prisma.order.create({
    data: {
      pageId,
      number: Math.floor(Math.random() * 1_000_000),
      code: randomUUID().slice(0, 4),
      tokenHash: randomUUID(),
      customerName: 'Aisyah',
      phone: '+60123456789',
      method: 'PICKUP',
      day: new Date('2026-12-01T00:00:00Z'),
      itemsCents: 100,
      deliveryCents: 0,
      totalCents: 100,
      chipPurchaseId: `p-${randomUUID()}`,
      chipPurchaseDueAt: due,
    },
  });

describe('POST /store/chip', () => {
  it('connecting checks the key and brand with CHIP and stores the key sealed', async () => {
    const owner = await anOwner(app);

    const res = await connect(app, owner.cookie, { brandId: `  ${BRAND} `, secretKey: ` ${SECRET}\n` });

    expect(res.statusCode).toBe(200);
    expect(clientFor).toHaveBeenCalledWith({ secretKey: SECRET, brandId: BRAND });
    expect(client.listPaymentMethods).toHaveBeenCalledWith(1000);
    expect(client.getPublicKey).toHaveBeenCalled();
    expect(res.json()).toEqual({
      connected: true,
      brandName: 'Kek Lina Bakes',
      methods: ['fpx', 'visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'duitnow_qr'],
      checkedAt: expect.any(String),
      isTest: false,
    });

    const row = await account(app, owner.pageId);
    expect(row).toMatchObject({ provider: 'CHIP', brandId: BRAND, publicKeyPem: PEM, isTest: false, brandName: 'Kek Lina Bakes', lastErrorAt: null });
    expect(row?.secretKeyCiphertext).not.toContain(SECRET);
    expect(openSecret(row!.secretKeyCiphertext, SECRETS_KEY)).toBe(SECRET);
  });

  it('learns test mode at connect from an RM1 purchase it cancels at once, card and e-wallet only', async () => {
    const owner = await anOwner(app);
    const probe = aPurchase({ isTest: true, brandName: 'Kek Lina Bakes' });
    client.createPurchase.mockResolvedValueOnce(probe);

    const res = await connect(app, owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json().isTest).toBe(true);
    const input = client.createPurchase.mock.calls[0]![0];
    expect(input).toMatchObject({ email: owner.email, amountCents: 100, cardsOnlyRecurring: false, sendReceipt: false });
    expect(input.successCallback).toBeUndefined();
    expect(input.methods).toEqual(['visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay']);
    expect(client.cancelPurchase).toHaveBeenCalledWith(probe.id);
    expect(await account(app, owner.pageId)).toMatchObject({ isTest: true, brandName: 'Kek Lina Bakes' });
  });

  it('checks an FPX-only account with an FPX-only purchase, never CHIP’s QR', async () => {
    const owner = await anOwner(app);
    client.listPaymentMethods.mockResolvedValue(['fpx', 'duitnow_qr']);

    const res = await connect(app, owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(client.createPurchase.mock.calls[0]![0].methods).toEqual(['fpx']);
    expect(await account(app, owner.pageId)).not.toBeNull();
  });

  it('refuses to check an account that takes no FPX, card or e-wallet', async () => {
    const owner = await anOwner(app);
    client.listPaymentMethods.mockResolvedValue(['duitnow_qr']);

    const res = await connect(app, owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'CHIP_NO_CHECK_METHOD',
      message: 'Your CHIP account takes no FPX, card or e-wallet yet, so Curios can’t check it. Turn one on in CHIP, then connect again.',
    });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await account(app, owner.pageId)).toBeNull();
  });

  it('will not swap in another CHIP account while a customer is paying, but reconnecting the same one is fine', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    await aPayingOrder(owner.pageId, new Date(Date.now() + 30 * 60 * 1000));

    const other = await connect(app, owner.cookie, { brandId: '1b7f3c4e-1a2b-4c5d-8e9f-0a1b2c3d4e5f', secretKey: SECRET });
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toEqual({ code: 'CHIP_PAYMENT_IN_FLIGHT', message: 'A customer is paying right now. Try again in an hour.' });
    expect((await connect(app, owner.cookie)).statusCode).toBe(200);
  });

  it('a test key is refused in production at connect, before anything is stored', async () => {
    const owner = await anOwner(live);
    const probe = aPurchase({ isTest: true });
    client.createPurchase.mockResolvedValueOnce(probe);

    const res = await connect(live, owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({ code: 'CHIP_TEST_KEY', message: 'This is a test key. Connect your live secret key from your CHIP dashboard, under Developers.' });
    expect(client.cancelPurchase).toHaveBeenCalledWith(probe.id);
    expect(await account(live, owner.pageId)).toBeNull();
  });

  it('a live key connects in production', async () => {
    const owner = await anOwner(live);
    expect((await connect(live, owner.cookie)).statusCode).toBe(200);
    expect(await account(live, owner.pageId)).toMatchObject({ isTest: false });
  });

  it('still connects when the check purchase cannot be cancelled', async () => {
    const owner = await anOwner(app);
    client.cancelPurchase.mockRejectedValueOnce(new ChipUnavailableError('POST answered 503'));
    expect((await connect(app, owner.cookie)).statusCode).toBe(200);
    expect(await account(app, owner.pageId)).not.toBeNull();
  });

  it('says so, and stores nothing, when CHIP will not start the check purchase', async () => {
    const owner = await anOwner(app);
    client.createPurchase.mockRejectedValueOnce(new ChipRefusedError('CHIP refused POST with 401: {}', 401));
    expect((await connect(app, owner.cookie)).json().error.code).toBe('CHIP_KEY_REFUSED');
    client.createPurchase.mockRejectedValueOnce(new ChipRefusedError('CHIP refused POST with 422: {}', 422));
    expect((await connect(app, owner.cookie)).json().error.code).toBe('CHIP_TEST_REFUSED');
    expect(await account(app, owner.pageId)).toBeNull();
  });

  it('reconnecting replaces the key, the brand and what CHIP says of them', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    await app.prisma.shopPaymentAccount.update({ where: { pageId: owner.pageId }, data: { brandName: 'Old', isTest: true } });
    const other = randomUUID();
    client.createPurchase.mockResolvedValueOnce(aPurchase({ brandName: 'New Name' }));

    expect((await connect(app, owner.cookie, { brandId: other, secretKey: `${SECRET}-new` })).statusCode).toBe(200);

    const row = await account(app, owner.pageId);
    expect(row).toMatchObject({ brandId: other, brandName: 'New Name', isTest: false });
    expect(openSecret(row!.secretKeyCiphertext, SECRETS_KEY)).toBe(`${SECRET}-new`);
  });

  it("says the key or Brand ID didn't work when CHIP refuses them, and stores nothing", async () => {
    const owner = await anOwner(app);
    for (const status of [400, 401, 403]) {
      client.listPaymentMethods.mockRejectedValueOnce(new ChipRefusedError(`CHIP refused GET with ${status}: {"detail":"no"}`, status));
      const res = await connect(app, owner.cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual({ code: 'CHIP_KEY_REFUSED', message: "That key or Brand ID didn't work. Copy both again from your CHIP dashboard, under Developers." });
    }
    client.getPublicKey.mockRejectedValueOnce(new ChipRefusedError('CHIP refused GET /public_key/ with 401: {}', 401));
    expect((await connect(app, owner.cookie)).json().error.code).toBe('CHIP_KEY_REFUSED');
    expect(await account(app, owner.pageId)).toBeNull();
  });

  it('says CHIP is not answering on an outage, and stores nothing', async () => {
    const owner = await anOwner(app);
    client.listPaymentMethods.mockRejectedValueOnce(new ChipUnavailableError('GET answered 503'));
    const res = await connect(app, owner.cookie);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('CHIP_UNAVAILABLE');
    expect(await account(app, owner.pageId)).toBeNull();
  });

  it('refuses a Brand ID or key that cannot be one, without calling CHIP', async () => {
    const owner = await anOwner(app);
    for (const payload of [
      { brandId: 'not-a-brand', secretKey: SECRET },
      { brandId: BRAND, secretKey: '   ' },
      { brandId: BRAND, secretKey: 'short' },
      { brandId: BRAND, secretKey: 'has spaces inside the key itself, which no key has' },
    ]) {
      const res = await connect(app, owner.cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_CHIP_KEY');
    }
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('is for a business page, signed in', async () => {
    expect((await call(app, 'POST', '/store/chip', undefined, { brandId: BRAND, secretKey: SECRET })).statusCode).toBe(401);
    const personal = await anOwner(app, 'PERSONAL');
    const res = await connect(app, personal.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('STORE_BUSINESS_ONLY');
  });

  it('says it is not configured where PAYMENT_SECRETS_KEY is not set', async () => {
    const owner = await anOwner(unconfigured);
    const res = await connect(unconfigured, owner.cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CHIP_NOT_CONFIGURED');
    expect(clientFor).not.toHaveBeenCalled();
  });
});

describe('DELETE /store/chip', () => {
  it('disconnect deletes the account, and a second disconnect is fine', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);

    const res = await call(app, 'DELETE', '/store/chip', owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: false });
    expect(await account(app, owner.pageId)).toBeNull();

    expect((await call(app, 'DELETE', '/store/chip', owner.cookie)).statusCode).toBe(200);
  });

  it('will not disconnect an open shop whose only way to pay is CHIP', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    expect((await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true })).statusCode).toBe(200);

    const res = await call(app, 'DELETE', '/store/chip', owner.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('STORE_NOT_READY');
    expect(await account(app, owner.pageId)).not.toBeNull();
  });
});

describe('POST /store/chip/test', () => {
  it("starts an RM1 purchase on the owner's own brand and key, card and e-wallet only", async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    clientFor.mockClear();

    const res = await call(app, 'POST', '/store/chip/test', owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://gate.chip-in.asia/p/test-purchase/' });
    expect(clientFor).toHaveBeenCalledWith({ secretKey: SECRET, brandId: BRAND });
    expect(client.listPaymentMethods).toHaveBeenLastCalledWith(100);
    const input = client.createPurchase.mock.calls.at(-1)![0];
    expect(input).toMatchObject({
      email: owner.email,
      amountCents: 100,
      reference: 'Curios test',
      redirectUrl: `${process.env.APP_URL ?? 'http://localhost:3000'}/app/store`,
      cardsOnlyRecurring: false,
    });
    expect(input.successCallback).toBeUndefined();
    expect(input.methods).toEqual(['visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay']);
    expect(input.methods).not.toContain('fpx');
  });

  it("records the brand's name and test mode from the purchase, and marks no order", async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    client.createPurchase.mockResolvedValueOnce(aPurchase({ brandName: 'Kek Lina Bakes', isTest: true }));

    expect((await call(app, 'POST', '/store/chip/test', owner.cookie)).statusCode).toBe(200);

    expect(await account(app, owner.pageId)).toMatchObject({ brandName: 'Kek Lina Bakes', isTest: true });
    expect(await app.prisma.order.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('in production, a key found to be a test one is refused and removed, when the shop can spare it', async () => {
    const owner = await anOwner(live);
    await connect(live, owner.cookie);
    const purchase = aPurchase({ isTest: true });
    client.createPurchase.mockResolvedValueOnce(purchase);

    const res = await call(live, 'POST', '/store/chip/test', owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({ code: 'CHIP_TEST_KEY', message: 'This is a test key. Connect your live secret key from your CHIP dashboard, under Developers.' });
    expect(client.cancelPurchase).toHaveBeenCalledWith(purchase.id);
    expect(await account(live, owner.pageId)).toBeNull();
  });

  it('in production, a test key that is an open shop\'s only way to pay is kept, marked, and refused', async () => {
    const owner = await anOwner(live);
    await connect(live, owner.cookie);
    expect((await call(live, 'PATCH', '/store/settings', owner.cookie, { enabled: true })).statusCode).toBe(200);
    const purchase = aPurchase({ isTest: true });
    client.createPurchase.mockResolvedValueOnce(purchase);

    const res = await call(live, 'POST', '/store/chip/test', owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CHIP_TEST_KEY');
    expect(client.cancelPurchase).toHaveBeenCalledWith(purchase.id);
    const row = await account(live, owner.pageId);
    expect(row).not.toBeNull();
    expect(row?.lastErrorAt).not.toBeNull();
  });

  it('says so when the account takes no card or e-wallet', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    client.listPaymentMethods.mockResolvedValueOnce(['fpx', 'duitnow_qr']);

    const res = await call(app, 'POST', '/store/chip/test', owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({ code: 'CHIP_NO_TEST_METHOD', message: 'Test with RM1 needs card or e-wallet on your CHIP account.' });
    // Only connecting's own check purchase; the test never starts one.
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
  });

  it('notes a key that stopped working', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    client.listPaymentMethods.mockRejectedValueOnce(new ChipRefusedError('CHIP refused GET with 401: {}', 401));

    const res = await call(app, 'POST', '/store/chip/test', owner.cookie);

    expect(res.json().error.code).toBe('CHIP_KEY_REFUSED');
    expect((await account(app, owner.pageId))?.lastErrorAt).not.toBeNull();
  });

  it('asks to connect first when nothing is connected', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/chip/test', owner.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CHIP_NOT_CONNECTED');
  });
});

describe('the secret key', () => {
  it('no API response ever contains the secret key', async () => {
    const owner = await anOwner(app);
    const bodies = [(await connect(app, owner.cookie)).body];
    const sealed = (await account(app, owner.pageId))!.secretKeyCiphertext;
    bodies.push((await call(app, 'GET', '/store', owner.cookie)).body);
    bodies.push((await call(app, 'POST', '/store/chip/test', owner.cookie)).body);
    bodies.push((await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true })).body);
    bodies.push((await call(app, 'DELETE', '/store/chip', owner.cookie)).body);
    client.listPaymentMethods.mockRejectedValueOnce(new ChipRefusedError(`CHIP refused with 401: ${SECRET}`, 401));
    bodies.push((await connect(app, owner.cookie)).body);

    for (const body of bodies) {
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(sealed);
    }
  });
});

describe('the CHIP limit', () => {
  it('has its own budget and words, so it never blocks paying for the plan', async () => {
    const owner = await anOwner(app);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(app, 'DELETE', '/store/chip', owner.cookie)).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    const limited = await call(app, 'DELETE', '/store/chip', owner.cookie);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.message).toMatch(/^Too many tries\. Wait a little and try again/);

    expect((await call(app, 'POST', '/billing/trial-reset', owner.cookie)).statusCode).not.toBe(429);
  });
});

describe('PAYMENT_SECRETS_KEY in production', () => {
  it('refuses to start without it', async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, PAYMENT_SECRETS_KEY: process.env.PAYMENT_SECRETS_KEY };
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENT_SECRETS_KEY;
    try {
      await expect(buildApp({ pages: { store: null }, orders: { store: null } })).rejects.toThrow(/PAYMENT_SECRETS_KEY is not set/);
    } finally {
      process.env.NODE_ENV = saved.NODE_ENV;
      process.env.PAYMENT_SECRETS_KEY = saved.PAYMENT_SECRETS_KEY;
    }
  });
});

describe('fix round 1: disconnecting while a customer pays', () => {
  it('is refused while a purchase can still be paid, and allowed once it cannot', async () => {
    const owner = await anOwner(app);
    await connect(app, owner.cookie);
    const paying = await aPayingOrder(owner.pageId, new Date(Date.now() + 30 * 60 * 1000));

    const res = await call(app, 'DELETE', '/store/chip', owner.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'CHIP_PAYMENT_IN_FLIGHT', message: 'A customer is paying right now. Try again in an hour.' });
    expect(await account(app, owner.pageId)).not.toBeNull();

    await app.prisma.order.update({ where: { id: paying.id }, data: { chipPurchaseDueAt: new Date(Date.now() - 1000) } });
    expect((await call(app, 'DELETE', '/store/chip', owner.cookie)).statusCode).toBe(200);
  });
});

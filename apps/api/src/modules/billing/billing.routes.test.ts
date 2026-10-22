import { generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MAIL_QUEUE } from '@curios/core';
import { CHIP_ENV, ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { buildApp } from '../../app.js';
import type { BillingRouteOptions } from './billing.routes.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

const client = {
  createPurchase: vi.fn<ChipClient['createPurchase']>(),
  getPurchase: vi.fn<ChipClient['getPurchase']>(),
  chargePurchase: vi.fn<ChipClient['chargePurchase']>(),
  deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
  cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
  getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
};

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so no limiter sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ billing: { client } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.createPurchase.mockImplementation(async (input) => ({
    id: `purchase-${randomUUID()}`,
    status: 'created',
    reference: input.reference,
    totalCents: input.amountCents,
    checkoutUrl: 'https://gate.chip-in.asia/p/stub/',
    isRecurringToken: false,
    isTest: true,
    paymentMethod: null,
    maskedPan: null,
  }));
});

async function anOwner(mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `billing-${randomUUID()}@example.com`,
      pages: { create: { handle: `bl-${slug}`, skeleton: `bl-${slug}`, displayName: 'Nadia Bakes', mode } },
    },
    select: { id: true, email: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, email: account.email, pageId: account.pages[0]?.id ?? '' };
}

async function aPendingPayment(pageId: string, autoRenew = false) {
  const providerRef = `purchase-${randomUUID()}`;
  const payment = await app.prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP', providerRef, autoRenew },
    select: { id: true },
  });
  return { providerRef, paymentId: payment.id };
}

function aPurchase(providerRef: string, paymentId: string, overrides: Partial<ChipPurchase> = {}): ChipPurchase {
  return {
    id: providerRef,
    status: 'paid',
    reference: paymentId,
    totalCents: 4900,
    checkoutUrl: `https://gate.chip-in.asia/p/${providerRef}/`,
    isRecurringToken: false,
    isTest: true,
    paymentMethod: 'fpx',
    maskedPan: null,
    ...overrides,
  };
}

/**
 * `vi.spyOn(...).mockRestore()` does not work on a Prisma model delegate: each method is
 * handed back freshly bound on every property read, so `Object.getOwnPropertyDescriptor`
 * -- what `spyOn` snapshots to restore later -- sees a placeholder (`{ value: undefined }`)
 * rather than the real function. Restoring from that snapshot leaves the method missing
 * instead of reviving it, breaking every test that runs after in this file. This installs
 * and restores the mock by hand instead, from a reference read before the mock went on --
 * plain `vi.fn()`, not `vi.spyOn`, since there is nothing here to call through to.
 */
function spyOnPrismaMethod<T extends object, M extends keyof T>(obj: T, method: M) {
  const original = obj[method];
  const mock = vi.fn();
  Object.defineProperty(obj, method, { value: mock, writable: true, configurable: true, enumerable: true });
  return {
    spy: mock,
    restore: () => {
      Object.defineProperty(obj, method, { value: original, writable: true, configurable: true, enumerable: true });
    },
  };
}

const paidUntilOf = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil;
const statusOf = async (paymentId: string) =>
  (await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status;

describe('POST /billing/purchases', () => {
  const start = (cookie: string | undefined, body: Record<string, unknown> = { plan: 'MONTHLY' }) =>
    app.inject({
      method: 'POST',
      url: '/billing/purchases',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
      payload: body,
    });

  it('refuses a caller with no session', async () => {
    expect((await start(undefined)).statusCode).toBe(401);
  });

  it('starts a purchase for a business page and answers its checkout URL', async () => {
    const owner = await anOwner();

    const res = await start(owner.cookie);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ url: 'https://gate.chip-in.asia/p/stub/' });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { id: true, status: true, amountCents: true, provider: true, autoRenew: true, providerRef: true },
    });
    expect(payment).toMatchObject({ status: 'PENDING', amountCents: 4900, provider: 'CHIP', autoRenew: false });
    expect(payment.providerRef).toMatch(/^purchase-/);
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
    const input = client.createPurchase.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      email: owner.email,
      fullName: 'Nadia Bakes',
      productName: 'Curios Business, 1 month — Nadia Bakes',
      amountCents: 4900,
      reference: payment.id,
      successCallback: 'https://api.curios.invalid/billing/chip/callback',
      redirectUrl: `https://api.curios.invalid/billing/chip/return?payment=${payment.id}`,
      sendReceipt: true,
      cardsOnlyRecurring: false,
    });
    // Due an hour from now: an unpaid purchase must stop being payable.
    const hour = (input?.dueAt.getTime() ?? 0) - Date.now();
    expect(hour).toBeGreaterThan(59 * 60_000);
    expect(hour).toBeLessThanOrEqual(60 * 60_000);
  });

  it('asks CHIP for a card token only when autoRenew is ticked', async () => {
    const owner = await anOwner();

    expect((await start(owner.cookie, { plan: 'ANNUAL', autoRenew: true })).statusCode).toBe(201);

    expect(client.createPurchase.mock.calls[0]?.[0]).toMatchObject({ cardsOnlyRecurring: true });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { autoRenew: true, plan: true },
    });
    expect(payment).toEqual({ autoRenew: true, plan: 'ANNUAL' });
  });

  it('refuses a personal page with NOT_A_BUSINESS_PAGE, and starts no purchase', async () => {
    const owner = await anOwner('PERSONAL');

    const res = await start(owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_BUSINESS_PAGE' } });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await app.prisma.payment.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('tells an owner with no page to claim a handle first', async () => {
    const account = await app.prisma.account.create({
      data: { email: `billing-nopage-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const { value } = await createSession(app.prisma, account.id);

    const res = await start(value);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });

  it('answers CHIP_UNAVAILABLE when CHIP is down, leaving a harmless pending row', async () => {
    const owner = await anOwner();
    client.createPurchase.mockRejectedValue(new ChipUnavailableError('connect ECONNREFUSED'));

    const res = await start(owner.cookie);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'CHIP_UNAVAILABLE' } });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { providerRef: true, status: true },
    });
    expect(payment).toEqual({ providerRef: null, status: 'PENDING' });
  });

  it('fails rather than hand out a checkout URL when the purchase id cannot be recorded, leaving an orphaned purchase behind', async () => {
    // CHIP has already accepted the purchase by this point. If the update below fails, the
    // Payment row must not look like the request succeeded -- an owner must never receive
    // a URL to a purchase nothing can later grant.
    const owner = await anOwner();
    const { spy: updateSpy, restore } = spyOnPrismaMethod(app.prisma.payment, 'update');
    updateSpy.mockRejectedValueOnce(new Error('database went away'));

    try {
      const res = await start(owner.cookie);

      expect(res.statusCode).toBe(500);
      expect(res.json()).not.toHaveProperty('url');
      const payment = await app.prisma.payment.findFirstOrThrow({
        where: { pageId: owner.pageId },
        select: { providerRef: true, status: true },
      });
      expect(payment).toEqual({ providerRef: null, status: 'PENDING' });
    } finally {
      restore();
    }
  });
});

describe('GET /billing/chip/return', () => {
  const visit = (paymentId: string) =>
    app.inject({ method: 'GET', url: `/billing/chip/return?payment=${paymentId}`, remoteAddress: from() });
  const BACK = 'http://localhost:3000/app/billing?payment=';

  it('fetches the purchase, grants it, and sends the owner back to the paid banner', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));

    const res = await visit(paymentId);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${BACK}paid`);
    expect(client.getPurchase).toHaveBeenCalledWith(providerRef);
    expect(await statusOf(paymentId)).toBe('PAID');
    expect(await paidUntilOf(owner.pageId)).not.toBeNull();
  });

  it('says failed for an expired purchase, and grants nothing', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId, { status: 'expired' }));

    const res = await visit(paymentId);

    expect(res.headers.location).toBe(`${BACK}failed`);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('says pending for a purchase still waiting on the payer', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId, { status: 'created' }));

    expect((await visit(paymentId)).headers.location).toBe(`${BACK}pending`);
  });

  it('says pending when CHIP cannot be reached', async () => {
    const owner = await anOwner();
    const { paymentId } = await aPendingPayment(owner.pageId);
    client.getPurchase.mockRejectedValue(new ChipUnavailableError('timeout'));

    const res = await visit(paymentId);

    expect(res.headers.location).toBe(`${BACK}pending`);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('adds card=off when auto-renew was asked but no token came back', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId, true);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId, { isRecurringToken: false }));

    const res = await visit(paymentId);

    expect(res.headers.location).toBe(`${BACK}paid&card=off`);
  });

  it('adds card=off when the callback granted first and no token came back', async () => {
    // The usual order in production: CHIP's callback lands before the browser returns.
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId, true);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId, { isRecurringToken: false }));
    await visit(paymentId);

    const res = await visit(paymentId);

    expect(await statusOf(paymentId)).toBe('PAID');
    expect(res.headers.location).toBe(`${BACK}paid&card=off`);
  });

  it('does not add card=off when the card was kept', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId, true);
    client.getPurchase.mockResolvedValue(
      aPurchase(providerRef, paymentId, { isRecurringToken: true, paymentMethod: 'visa', maskedPan: '411111******1111' }),
    );

    expect((await visit(paymentId)).headers.location).toBe(`${BACK}paid`);
  });

  it('does not add card=off when auto-renew was never asked', async () => {
    const owner = await anOwner();
    const { providerRef, paymentId } = await aPendingPayment(owner.pageId, false);
    client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));

    expect((await visit(paymentId)).headers.location).toBe(`${BACK}paid`);
  });

  it('says pending for a payment id we never created, without asking CHIP', async () => {
    const res = await visit('does-not-exist');

    expect(res.headers.location).toBe(`${BACK}pending`);
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('says pending for a payment that never reached CHIP', async () => {
    const owner = await anOwner();
    const payment = await app.prisma.payment.create({
      data: { pageId: owner.pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP' },
      select: { id: true },
    });

    expect((await visit(payment.id)).headers.location).toBe(`${BACK}pending`);
    expect(client.getPurchase).not.toHaveBeenCalled();
  });
});


describe('GET /billing/chip/return, when the database fails', () => {
  it('says pending rather than answering 500', async () => {
    const owner = await anOwner();
    const { paymentId } = await aPendingPayment(owner.pageId);
    const { spy, restore } = spyOnPrismaMethod(app.prisma.payment, 'findUnique');
    spy.mockRejectedValueOnce(new Error('database went away'));

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/billing/chip/return?payment=${paymentId}`,
        remoteAddress: from(),
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=pending');
      expect(client.getPurchase).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// CHIP's server-to-server messages. Signed with key pairs made here, and the public halves
// handed to the routes through the environment, as they are in a deployment.
describe('CHIP callback and webhook', () => {
  const pair = () =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  const callbackKeys = pair();
  const webhookKeys = pair();
  const sign = (body: string, privateKey: string) =>
    cryptoSign('sha256', Buffer.from(body), privateKey).toString('base64');

  const KEYS = ['CHIP_PUBLIC_KEY', 'CHIP_WEBHOOK_PUBLIC_KEY'] as const;
  const saved = Object.fromEntries(KEYS.map((name) => [name, process.env[name]]));
  const restoreEnv = () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  const onRenewalFailure = vi.fn<NonNullable<BillingRouteOptions['onRenewalFailure']>>();
  const apps: FastifyInstance[] = [];

  /**
   * An app built with exactly these keys in the environment, whatever a developer's .env says.
   * `realHook` leaves onRenewalFailure out, so the app wires its own: the owner's email.
   */
  async function appWith(keys: { callback?: string; webhook?: string }, realHook = false) {
    delete process.env.CHIP_PUBLIC_KEY;
    delete process.env.CHIP_WEBHOOK_PUBLIC_KEY;
    if (keys.callback) process.env.CHIP_PUBLIC_KEY = keys.callback;
    if (keys.webhook) process.env.CHIP_WEBHOOK_PUBLIC_KEY = keys.webhook;
    try {
      const built = await buildApp({ billing: realHook ? { client } : { client, onRenewalFailure } });
      await built.ready();
      apps.push(built);
      return built;
    } finally {
      restoreEnv();
    }
  }

  let keyed: FastifyInstance;
  beforeAll(async () => {
    keyed = await appWith({ callback: callbackKeys.publicKey, webhook: webhookKeys.publicKey });
  });
  afterAll(async () => {
    restoreEnv();
    await Promise.all(apps.map((built) => built.close()));
  });
  beforeEach(() => {
    onRenewalFailure.mockReset().mockResolvedValue(undefined);
  });

  const post = (target: FastifyInstance, url: string, body: string, signature: string | undefined) =>
    target.inject({
      method: 'POST',
      url,
      remoteAddress: from(),
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-signature': signature } : {}) },
      payload: body,
    });
  const callback = (body: string, signature: string | undefined = sign(body, callbackKeys.privateKey)) =>
    post(keyed, '/billing/chip/callback', body, signature);
  const webhook = (body: string, signature: string | undefined = sign(body, webhookKeys.privateKey)) =>
    post(keyed, '/billing/chip/webhook', body, signature);

  describe('POST /billing/chip/callback', () => {
    it('verifies the raw body, not a re-serialised one', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      // Odd whitespace and key order: signed as sent it is genuine, and re-serialised it is not.
      const sent = `{ "status":"paid",\n   "id" : "${providerRef}" }`;
      const signature = sign(sent, callbackKeys.privateKey);
      const reserialised = JSON.stringify(JSON.parse(sent));

      expect((await callback(reserialised, signature)).statusCode).toBe(400);
      expect(client.getPurchase).not.toHaveBeenCalled();

      expect((await callback(sent, signature)).statusCode).toBe(200);
      expect(await statusOf(paymentId)).toBe('PAID');
    });

    it('reads keys pasted on one line, each newline written as \\n', async () => {
      const oneLine = (pem: string) => pem.trim().replaceAll('\n', String.raw`\n`);
      const escaped = await appWith({ callback: oneLine(callbackKeys.publicKey), webhook: oneLine(webhookKeys.publicKey) });
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      const body = JSON.stringify({ id: providerRef });

      const res = await post(escaped, '/billing/chip/callback', body, sign(body, callbackKeys.privateKey));
      expect(res.statusCode).toBe(200);
      expect(await statusOf(paymentId)).toBe('PAID');
      const hook = JSON.stringify({ id: 'none', event_type: 'purchase.created' });
      expect((await post(escaped, '/billing/chip/webhook', hook, sign(hook, webhookKeys.privateKey))).statusCode).toBe(200);
    });

    it('refuses a callback without a valid signature with 400 and grants nothing', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      const body = JSON.stringify({ id: providerRef });

      const missing = await callback(body, '');
      const forged = await callback(body, sign(body, pair().privateKey));

      expect(missing.statusCode).toBe(400);
      expect(forged.statusCode).toBe(400);
      expect(client.getPurchase).not.toHaveBeenCalled();
      expect(await statusOf(paymentId)).toBe('PENDING');
    });

    it('grants on a verified callback after fetching the purchase', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      // What CHIP says about the purchase decides; the body only names it.
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));

      const res = await callback(JSON.stringify({ id: providerRef, status: 'paid', total: 1 }));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'granted' });
      expect(client.getPurchase).toHaveBeenCalledWith(providerRef);
      expect(await statusOf(paymentId)).toBe('PAID');
      expect(await paidUntilOf(owner.pageId)).not.toBeNull();
    });

    it('answers 200 already-granted to a repeat', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      const body = JSON.stringify({ id: providerRef });
      await callback(body);
      const once = await paidUntilOf(owner.pageId);

      const res = await callback(body);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'already-granted' });
      expect(await paidUntilOf(owner.pageId)).toEqual(once);
    });

    it('answers 200 ignored for a signed body with no purchase id', async () => {
      const res = await callback(JSON.stringify({ nothing: 'here' }));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ignored' });
      expect(client.getPurchase).not.toHaveBeenCalled();
    });

    it('answers 500 when the database fails, so CHIP retries', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      const { spy, restore } = spyOnPrismaMethod(app.prisma, '$transaction');
      spy.mockRejectedValueOnce(new Error('database went away'));

      try {
        const res = await callback(JSON.stringify({ id: providerRef }));

        expect(res.statusCode).toBe(500);
        expect(await statusOf(paymentId)).toBe('PENDING');
      } finally {
        restore();
      }
    });

    it("fetches CHIP's public key once when CHIP_PUBLIC_KEY is unset", async () => {
      const unkeyed = await appWith({});
      client.getPublicKey.mockResolvedValue(callbackKeys.publicKey);
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      const body = JSON.stringify({ id: providerRef });
      const signature = sign(body, callbackKeys.privateKey);

      const first = await post(unkeyed, '/billing/chip/callback', body, signature);
      const second = await post(unkeyed, '/billing/chip/callback', body, signature);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(client.getPublicKey).toHaveBeenCalledTimes(1);
    });

    it('refuses an unsigned callback before fetching any key', async () => {
      const unkeyed = await appWith({});
      client.getPublicKey.mockResolvedValue(callbackKeys.publicKey);

      const res = await post(unkeyed, '/billing/chip/callback', JSON.stringify({ id: 'purchase-x' }), undefined);

      expect(res.statusCode).toBe(400);
      expect(client.getPublicKey).not.toHaveBeenCalled();
      expect(client.getPurchase).not.toHaveBeenCalled();
    });

    it('answers 500 and tries again next time when the key cannot be fetched', async () => {
      const unkeyed = await appWith({});
      client.getPublicKey.mockRejectedValueOnce(new ChipUnavailableError('timeout'));
      client.getPublicKey.mockResolvedValue(callbackKeys.publicKey);
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));
      const body = JSON.stringify({ id: providerRef });
      const signature = sign(body, callbackKeys.privateKey);

      const failed = await post(unkeyed, '/billing/chip/callback', body, signature);
      const retried = await post(unkeyed, '/billing/chip/callback', body, signature);

      expect(failed.statusCode).toBeGreaterThanOrEqual(500);
      expect(retried.statusCode).toBe(200);
      expect(client.getPublicKey).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /billing/chip/webhook', () => {
    it('grants on purchase.paid', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      client.getPurchase.mockResolvedValue(aPurchase(providerRef, paymentId));

      const res = await webhook(JSON.stringify({ id: providerRef, event_type: 'purchase.paid' }));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'granted' });
      expect(await statusOf(paymentId)).toBe('PAID');
    });

    it('records a renewal failure on purchase.payment_failure, and tells the hook', async () => {
      const owner = await anOwner();
      await app.prisma.renewalCard.create({
        data: { pageId: owner.pageId, token: `tok-${randomUUID()}`, plan: 'MONTHLY', cardLabel: 'Visa 1111' },
      });
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
      await app.prisma.payment.update({ where: { id: paymentId }, data: { autoRenewal: true } });

      const res = await webhook(JSON.stringify({ id: providerRef, event_type: 'purchase.payment_failure' }));

      expect(res.statusCode).toBe(200);
      expect(await statusOf(paymentId)).toBe('FAILED');
      expect(onRenewalFailure).toHaveBeenCalledWith(owner.pageId, { kind: 'retry', attempts: 1 });
      expect(client.getPurchase).not.toHaveBeenCalled();
    });

    it("the webhook's renewal failure mails the owner", async () => {
      const wired = await appWith({ callback: callbackKeys.publicKey, webhook: webhookKeys.publicKey }, true);
      const add = vi.spyOn(wired.mailQueue, 'add').mockResolvedValue({} as never);
      try {
        const owner = await anOwner();
        await app.prisma.page.update({
          where: { id: owner.pageId },
          data: { paidUntil: new Date(Date.now() + 12 * 60 * 60 * 1000) },
        });
        await app.prisma.renewalCard.create({
          data: { pageId: owner.pageId, token: `tok-${randomUUID()}`, plan: 'MONTHLY', cardLabel: 'Visa 1111' },
        });
        const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
        await app.prisma.payment.update({ where: { id: paymentId }, data: { autoRenewal: true } });
        const body = JSON.stringify({ id: providerRef, event_type: 'purchase.payment_failure' });

        const res = await post(wired, '/billing/chip/webhook', body, sign(body, webhookKeys.privateKey));

        expect(res.statusCode).toBe(200);
        expect(add).toHaveBeenCalledTimes(1);
        const [name, mail] = add.mock.calls[0] ?? [];
        expect(name).toBe(MAIL_QUEUE);
        expect(mail).toMatchObject({ to: owner.email, subject: "We couldn't renew your Curios plan" });
        expect(mail?.text).toContain('http://localhost:3000/app/billing');
      } finally {
        add.mockRestore();
      }
    });

    it('still answers 200 when the renewal email cannot be queued', async () => {
      // The failure is committed; a 500 would only make CHIP resend into a FAILED payment.
      const wired = await appWith({ callback: callbackKeys.publicKey, webhook: webhookKeys.publicKey }, true);
      const add = vi.spyOn(wired.mailQueue, 'add').mockRejectedValue(new Error('redis went away'));
      try {
        const owner = await anOwner();
        await app.prisma.page.update({ where: { id: owner.pageId }, data: { paidUntil: new Date() } });
        await app.prisma.renewalCard.create({
          data: { pageId: owner.pageId, token: `tok-${randomUUID()}`, plan: 'MONTHLY' },
        });
        const { providerRef, paymentId } = await aPendingPayment(owner.pageId);
        await app.prisma.payment.update({ where: { id: paymentId }, data: { autoRenewal: true } });
        const body = JSON.stringify({ id: providerRef, event_type: 'purchase.payment_failure' });

        const res = await post(wired, '/billing/chip/webhook', body, sign(body, webhookKeys.privateKey));

        expect(res.statusCode).toBe(200);
        expect(await statusOf(paymentId)).toBe('FAILED');
      } finally {
        add.mockRestore();
      }
    });

    it('ignores a failure for a payment that was not a renewal', async () => {
      const owner = await anOwner();
      const { providerRef, paymentId } = await aPendingPayment(owner.pageId);

      const res = await webhook(JSON.stringify({ id: providerRef, event_type: 'purchase.payment_failure' }));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ignored' });
      expect(await statusOf(paymentId)).toBe('PENDING');
      expect(onRenewalFailure).not.toHaveBeenCalled();
    });

    it('ignores an event it does not act on', async () => {
      const res = await webhook(JSON.stringify({ id: 'purchase-x', event_type: 'purchase.created' }));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ignored' });
    });

    it('refuses an unsigned webhook with 400', async () => {
      const res = await webhook(JSON.stringify({ id: 'purchase-x', event_type: 'purchase.paid' }), '');

      expect(res.statusCode).toBe(400);
      expect(client.getPurchase).not.toHaveBeenCalled();
    });

    it('refuses a callback-key signature', async () => {
      const owner = await anOwner();
      const { providerRef } = await aPendingPayment(owner.pageId);
      const body = JSON.stringify({ id: providerRef, event_type: 'purchase.paid' });

      const res = await webhook(body, sign(body, callbackKeys.privateKey));

      expect(res.statusCode).toBe(400);
      expect(client.getPurchase).not.toHaveBeenCalled();
    });

    it('is not registered when no webhook key is set outside production', async () => {
      const noWebhook = await appWith({ callback: callbackKeys.publicKey });

      const res = await post(noWebhook, '/billing/chip/webhook', '{}', sign('{}', webhookKeys.privateKey));

      expect(res.statusCode).toBe(404);
    });
  });
});

describe('POST /billing/auto-renew/off', () => {
  const off = (cookie: string | undefined) =>
    app.inject({
      method: 'POST',
      url: '/billing/auto-renew/off',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
    });
  const aCard = async (pageId: string) => {
    const token = `tok-${randomUUID()}`;
    await app.prisma.renewalCard.create({ data: { pageId, token, plan: 'MONTHLY', cardLabel: 'Visa ending 1111' } });
    return token;
  };
  const cardOf = (pageId: string) => app.prisma.renewalCard.findUnique({ where: { pageId } });

  it('refuses a caller with no session', async () => {
    expect((await off(undefined)).statusCode).toBe(401);
  });

  it('turning auto-renew off deletes the card and the token', async () => {
    const owner = await anOwner();
    const token = await aCard(owner.pageId);

    const res = await off(owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'off' });
    expect(await cardOf(owner.pageId)).toBeNull();
    expect(client.deleteRecurringToken).toHaveBeenCalledWith(token);
  });

  it('turning it off still deletes the card when CHIP is down', async () => {
    const owner = await anOwner();
    await aCard(owner.pageId);
    client.deleteRecurringToken.mockRejectedValue(new ChipUnavailableError('timeout'));

    const res = await off(owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(await cardOf(owner.pageId)).toBeNull();
  });

  it('answers off when auto-renew already is, without asking CHIP', async () => {
    const owner = await anOwner();

    const res = await off(owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'off' });
    expect(client.deleteRecurringToken).not.toHaveBeenCalled();
  });

  it("leaves another owner's card alone", async () => {
    const owner = await anOwner();
    const other = await anOwner();
    await aCard(other.pageId);

    await off(owner.cookie);

    expect(await cardOf(other.pageId)).not.toBeNull();
  });
});

describe('POST /billing/trial-reset', () => {
  const reset = (cookie: string | undefined) =>
    app.inject({
      method: 'POST',
      url: '/billing/trial-reset',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
    });

  const pageRow = (pageId: string) =>
    app.prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true, trialResetAt: true },
    });

  it('refuses a caller with no session', async () => {
    expect((await reset(undefined)).statusCode).toBe(401);
  });

  it('gives a spent trial back to a page that never paid', async () => {
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'reset' });
    const page = await pageRow(owner.pageId);
    expect(page.leadsCaptured).toBe(0);
    expect(page.trialResetAt).not.toBeNull();
  });

  it('refuses the second reset, and leaves the count where it was', async () => {
    // The whole point of the stamp: one reset, not one per click.
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });
    await reset(owner.cookie);
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 2 } });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'TRIAL_RESET_USED' } });
    expect((await pageRow(owner.pageId)).leadsCaptured).toBe(2);
  });

  it('refuses a page that has paid before, even one whose plan lapsed', async () => {
    // A lapsed page owes a renewal. A free trial back would be a discount
    // nobody decided to give.
    const owner = await anOwner();
    await app.prisma.page.update({
      where: { id: owner.pageId },
      data: { leadsCaptured: 3, paidUntil: new Date('2026-01-01T00:00:00.000Z') },
    });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect((await pageRow(owner.pageId)).leadsCaptured).toBe(3);
  });

  it('refuses a reset that would give nothing back', async () => {
    // Zero leads captured: resetting would spend the one reset on nothing, and
    // an owner who later needs it would find it gone.
    const owner = await anOwner();

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect((await pageRow(owner.pageId)).trialResetAt).toBeNull();
  });

  it('refuses a personal page, which has no trial to reset', async () => {
    const owner = await anOwner('PERSONAL');
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });

    expect((await reset(owner.cookie)).statusCode).toBe(409);
  });

  it('resets the order allowance once, keeping order numbers', async () => {
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { ordersPlaced: 3 } });
    const counts = () =>
      app.prisma.page.findUniqueOrThrow({
        where: { id: owner.pageId },
        select: { ordersPlaced: true, ordersAtTrialReset: true, leadsCaptured: true, trialResetAt: true },
      });

    // Orders alone, with no leads, are something to give back.
    expect((await reset(owner.cookie)).statusCode).toBe(200);
    const after = await counts();
    expect(after).toMatchObject({ ordersPlaced: 3, ordersAtTrialReset: 3, leadsCaptured: 0 });
    expect(after.trialResetAt).not.toBeNull();

    // Once: more orders do not buy a second reset.
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { ordersPlaced: 5 } });
    expect((await reset(owner.cookie)).statusCode).toBe(409);
    expect(await counts()).toMatchObject({ ordersPlaced: 5, ordersAtTrialReset: 3 });
  });

  it('refuses when neither leads nor orders have been used since', async () => {
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { ordersPlaced: 2, ordersAtTrialReset: 2 } });
    expect((await reset(owner.cookie)).statusCode).toBe(409);
  });
});

// Development with no CHIP settings at all: the API still boots, so a developer
// working on anything else needs no CHIP account. Production never does.
describe('with billing switched off', () => {
  const saved = Object.fromEntries(CHIP_ENV.map((name) => [name, process.env[name]]));
  const savedNodeEnv = process.env.NODE_ENV;
  let offApp: FastifyInstance;

  beforeAll(async () => {
    for (const name of CHIP_ENV) delete process.env[name];
    offApp = await buildApp();
    await offApp.ready();
  });

  afterAll(async () => {
    await offApp.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.env.NODE_ENV = savedNodeEnv;
  });

  async function anOffOwner() {
    const slug = randomUUID().slice(0, 8);
    const account = await offApp.prisma.account.create({
      data: {
        email: `billing-off-${randomUUID()}@example.com`,
        pages: { create: { handle: `bo-${slug}`, skeleton: `bo-${slug}`, displayName: 'Nadia Bakes', mode: 'BUSINESS' } },
      },
      select: { id: true, pages: { select: { id: true } } },
    });
    const { value } = await createSession(offApp.prisma, account.id);
    return { cookie: value, pageId: account.pages[0]?.id ?? '' };
  }

  it('answers a payment with its own code, and starts no purchase', async () => {
    const owner = await anOffOwner();

    const res = await offApp.inject({
      method: 'POST',
      url: '/billing/purchases',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
      payload: { plan: 'MONTHLY' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('BILLING_NOT_CONFIGURED');
    expect(await offApp.prisma.payment.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  // No purchase can exist, so there is nothing for CHIP to send the owner back from.
  it('does not register the CHIP return', async () => {
    const res = await offApp.inject({ method: 'GET', url: '/billing/chip/return?payment=anything' });

    expect(res.statusCode).toBe(404);
  });

  // Nothing about the trial reset touches CHIP.
  it('still resets a spent trial', async () => {
    const owner = await anOffOwner();
    await offApp.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });

    const res = await offApp.inject({
      method: 'POST',
      url: '/billing/trial-reset',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
    });

    expect(res.statusCode).toBe(200);
  });

  it('refuses to start in production without the settings', async () => {
    process.env.NODE_ENV = 'production';
    try {
      // `store: null` on each storage consumer sidesteps storage's own
      // production check (storage is unset throughout this suite -- see
      // vitest.setup.ts) so this test isolates the one setting it actually
      // means to prove: CHIP's.
      await expect(buildApp({ pages: { store: null }, orders: { store: null } })).rejects.toThrow(/CHIP_SECRET_KEY is not set/);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

// The webhook's public key is the one setting that is optional in development and not in
// production: without it every genuine webhook would be refused, so it fails the deploy.
describe('in production', () => {
  const names = [...CHIP_ENV, 'CHIP_WEBHOOK_PUBLIC_KEY'] as const;
  const saved = Object.fromEntries([...names, 'NODE_ENV'].map((name) => [name, process.env[name]]));

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('refuses to start without CHIP_WEBHOOK_PUBLIC_KEY, naming it', async () => {
    process.env.NODE_ENV = 'production';
    for (const name of CHIP_ENV) process.env[name] = 'https://api.curios.invalid';
    delete process.env.CHIP_WEBHOOK_PUBLIC_KEY;

    await expect(buildApp({ pages: { store: null }, orders: { store: null } })).rejects.toThrow(
      /CHIP_WEBHOOK_PUBLIC_KEY is not set/,
    );
  });
});

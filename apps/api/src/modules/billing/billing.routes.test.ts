import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  BILLPLZ_ENV,
  BillplzUnavailableError,
  flattenRedirectParams,
  signBillplz,
  type BillplzBill,
  type BillplzClient,
} from '@curios/billing';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

// Both pinned in apps/api/vitest.setup.ts.
const KEY = 'test-signature-key';
const COLLECTION = 'test-collection';

const client = {
  createBill: vi.fn<BillplzClient['createBill']>(),
  getBill: vi.fn<BillplzClient['getBill']>(),
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
  client.createBill.mockReset();
  client.getBill.mockReset();
  client.createBill.mockImplementation(async (input) => ({
    id: `bill-${randomUUID()}`,
    collectionId: input.collectionId,
    paid: false,
    state: 'due',
    amount: input.amountCents,
    paidAmount: 0,
    reference1: input.reference1,
    url: 'https://www.billplz-sandbox.com/bills/stub',
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

async function aPendingPayment(pageId: string) {
  const billId = `bill-${randomUUID()}`;
  const payment = await app.prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: COLLECTION, billplzBillId: billId },
    select: { id: true },
  });
  return { billId, paymentId: payment.id };
}

function callbackBody(billId: string, overrides: Record<string, string> = {}, signature?: string) {
  const params: Record<string, string> = {
    id: billId,
    collection_id: COLLECTION,
    paid: 'true',
    state: 'paid',
    amount: '3900',
    paid_amount: '3900',
    due_at: '2026-9-14',
    email: 'payer@example.com',
    mobile: '',
    name: 'Nadia Bakes',
    url: `https://www.billplz-sandbox.com/bills/${billId}`,
    paid_at: '2026-09-14 15:15:09 +0800',
    ...overrides,
  };
  return new URLSearchParams({ ...params, x_signature: signature ?? signBillplz(params, KEY) }).toString();
}

function returnUrl(billId: string, paid: 'true' | 'false', signature?: string) {
  const query: Record<string, string> = {
    'billplz[id]': billId,
    'billplz[paid]': paid,
    'billplz[paid_at]': '2026-09-14 15:15:09 +0800',
  };
  const signed = { ...query, 'billplz[x_signature]': signature ?? signBillplz(flattenRedirectParams(query), KEY) };
  return `/billing/billplz/return?${new URLSearchParams(signed).toString()}`;
}

function paidBill(billId: string, paymentId: string): BillplzBill {
  return {
    id: billId,
    collectionId: COLLECTION,
    paid: true,
    state: 'paid',
    amount: 3900,
    paidAmount: 3900,
    reference1: paymentId,
    url: `https://www.billplz-sandbox.com/bills/${billId}`,
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

const postCallback = (payload: string) =>
  app.inject({
    method: 'POST',
    url: '/billing/billplz/callback',
    remoteAddress: from(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload,
  });

const paidUntilOf = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil;
const statusOf = async (paymentId: string) =>
  (await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status;

describe('POST /billing/bills', () => {
  const raise = (cookie: string | undefined, plan = 'MONTHLY') =>
    app.inject({
      method: 'POST',
      url: '/billing/bills',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
      payload: { plan },
    });

  it('refuses a caller with no session', async () => {
    expect((await raise(undefined)).statusCode).toBe(401);
  });

  it("raises a bill for the owner's page, bound to a new pending payment", async () => {
    const owner = await anOwner();

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ url: 'https://www.billplz-sandbox.com/bills/stub' });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { id: true, status: true, amountCents: true, billplzCollectionId: true, billplzBillId: true },
    });
    expect(payment).toMatchObject({ status: 'PENDING', amountCents: 3900, billplzCollectionId: COLLECTION });
    expect(payment.billplzBillId).toMatch(/^bill-/);
    expect(client.createBill).toHaveBeenCalledWith({
      collectionId: COLLECTION,
      email: owner.email,
      name: 'Nadia Bakes',
      amountCents: 3900,
      description: 'Curios Business, 1 month — Nadia Bakes',
      callbackUrl: 'http://localhost:3001/billing/billplz/callback',
      redirectUrl: 'http://localhost:3001/billing/billplz/return',
      reference1: payment.id,
    });
  });

  it('refuses a personal page, and raises no bill', async () => {
    const owner = await anOwner('PERSONAL');

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_BUSINESS_PAGE' } });
    expect(client.createBill).not.toHaveBeenCalled();
    expect(await app.prisma.payment.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('tells an owner with no page to claim a handle first', async () => {
    const account = await app.prisma.account.create({
      data: { email: `billing-nopage-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const { value } = await createSession(app.prisma, account.id);

    const res = await raise(value);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });

  it('reports Billplz being down by its own code, leaving a harmless pending row', async () => {
    const owner = await anOwner();
    client.createBill.mockRejectedValue(new BillplzUnavailableError('connect ECONNREFUSED'));

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'BILLPLZ_UNAVAILABLE' } });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { billplzBillId: true, status: true },
    });
    expect(payment).toEqual({ billplzBillId: null, status: 'PENDING' });
  });

  it('fails rather than hand out a bill URL when the bill id cannot be recorded, leaving an orphaned bill behind', async () => {
    // Billplz has already accepted the bill by this point. If the update below fails, the
    // Payment row must not look like the request succeeded -- an owner must never receive
    // a URL to a bill nothing can later grant.
    const owner = await anOwner();
    const { spy: updateSpy, restore } = spyOnPrismaMethod(app.prisma.payment, 'update');
    updateSpy.mockRejectedValueOnce(new Error('database went away'));

    try {
      const res = await raise(owner.cookie);

      expect(res.statusCode).toBe(500);
      expect(res.json()).not.toHaveProperty('url');
      const payment = await app.prisma.payment.findFirstOrThrow({
        where: { pageId: owner.pageId },
        select: { billplzBillId: true, status: true },
      });
      expect(payment).toEqual({ billplzBillId: null, status: 'PENDING' });
    } finally {
      restore();
    }
  });
});

describe('POST /billing/billplz/callback', () => {
  it('grants a signed, paid callback sent as a form', async () => {
    // The path that would be a 415 without the form parser this task adds.
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PAID');
    expect(await paidUntilOf(owner.pageId)).not.toBeNull();
  });

  it('refuses a callback whose signature does not verify', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, {}, 'f'.repeat(64)));

    expect(res.statusCode).toBe(400);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('answers 200 to a signed callback for an unpaid bill, and grants nothing', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, { paid: 'false', state: 'due', paid_amount: '0' }));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('answers 200 to a signed callback whose amount does not match, and grants nothing', async () => {
    // Signed, so it came from Billplz -- and still refused, because it is not what we billed.
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, { paid_amount: '100' }));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PENDING');
    expect(await paidUntilOf(owner.pageId)).toBeNull();
  });

  it('answers 500 to a signed, paid callback when granting fails unexpectedly, so Billplz retries', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);
    // grantPayment's first database call.
    const { spy: findUniqueSpy, restore } = spyOnPrismaMethod(app.prisma.payment, 'findUnique');
    findUniqueSpy.mockRejectedValueOnce(new Error('database went away'));

    try {
      const res = await postCallback(callbackBody(billId));

      expect(res.statusCode).toBe(500);
      expect(await statusOf(paymentId)).toBe('PENDING');
    } finally {
      restore();
    }
  });
});

describe('GET /billing/billplz/return', () => {
  const visit = (url: string) => app.inject({ method: 'GET', url, remoteAddress: from() });

  it('fetches the bill, grants it, and sends the owner back to the paid banner', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);
    client.getBill.mockResolvedValue(paidBill(billId, paymentId));

    const res = await visit(returnUrl(billId, 'true'));

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=paid');
    expect(client.getBill).toHaveBeenCalledWith(billId);
    expect(await statusOf(paymentId)).toBe('PAID');
  });

  it('sends a signed but unpaid redirect to the failed banner, without fetching', async () => {
    const owner = await anOwner();
    const { billId } = await aPendingPayment(owner.pageId);

    const res = await visit(returnUrl(billId, 'false'));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=failed');
    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('sends a redirect whose signature does not verify to pending, without fetching', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await visit(returnUrl(billId, 'true', 'f'.repeat(64)));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=pending');
    expect(client.getBill).not.toHaveBeenCalled();
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('sends the owner to pending when the bill cannot be fetched', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);
    client.getBill.mockRejectedValue(new BillplzUnavailableError('timeout'));

    const res = await visit(returnUrl(billId, 'true'));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=pending');
    expect(await statusOf(paymentId)).toBe('PENDING');
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
});

// Development with no Billplz settings at all: the API still boots, so a developer
// working on anything else needs no Billplz sandbox account. Production never does.
describe('with billing switched off', () => {
  const saved = Object.fromEntries(BILLPLZ_ENV.map((name) => [name, process.env[name]]));
  const savedNodeEnv = process.env.NODE_ENV;
  let offApp: FastifyInstance;

  beforeAll(async () => {
    for (const name of BILLPLZ_ENV) delete process.env[name];
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

  it('answers a payment with its own code, and raises no bill', async () => {
    const owner = await anOffOwner();

    const res = await offApp.inject({
      method: 'POST',
      url: '/billing/bills',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
      payload: { plan: 'MONTHLY' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('BILLING_NOT_CONFIGURED');
    expect(await offApp.prisma.payment.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  // No bill can exist, so Billplz has nothing to call back about.
  it('does not register the Billplz callback', async () => {
    const res = await offApp.inject({
      method: 'POST',
      url: '/billing/billplz/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'id=anything',
    });

    expect(res.statusCode).toBe(404);
  });

  // Nothing about the trial reset touches Billplz.
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
      // `pages: { store: null }` sidesteps Task 9's own production check
      // (storage is unset throughout this suite -- see vitest.setup.ts) so
      // this test isolates the one setting it actually means to prove: Billplz's.
      await expect(buildApp({ pages: { store: null } })).rejects.toThrow(/BILLPLZ_API_KEY is not set/);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

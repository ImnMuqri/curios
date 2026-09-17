import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
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

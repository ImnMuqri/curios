import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { extendPaidUntil } from '@curios/core';
import { PrismaClient } from '@curios/db';
import { evidenceFromBill, evidenceFromCallback, grantPayment, type BillEvidence } from './grant.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-14T08:00:00.000Z');
const ONE_MONTH = extendPaidUntil({ paidUntil: null, now: NOW, plan: 'MONTHLY' });

beforeEach(async () => {
  // Reaches Payment too: TRUNCATE ... CASCADE follows the foreign keys regardless of
  // their ON DELETE rule, so Restrict does not stop it.
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aPage(paidUntil: Date | null = null): Promise<string> {
  const skeleton = `grant-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `grant-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes', paidUntil } },
    },
    select: { pages: { select: { id: true } } },
  });
  return account.pages[0]?.id ?? '';
}

async function aPendingPayment(pageId: string, billId: string, plan: 'MONTHLY' | 'ANNUAL' = 'MONTHLY') {
  return prisma.payment.create({
    data: {
      pageId,
      plan,
      amountCents: plan === 'ANNUAL' ? 39000 : 3900,
      billplzCollectionId: 'col-test',
      billplzBillId: billId,
    },
    select: { id: true },
  });
}

function paid(billId: string, overrides: Partial<BillEvidence> = {}): BillEvidence {
  return { billId, collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900, ...overrides };
}

const pageRow = (id: string) =>
  prisma.page.findUniqueOrThrow({ where: { id }, select: { paidUntil: true } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({
    where: { id },
    select: { status: true, paidAt: true, grantedUntil: true },
  });

describe('grantPayment', () => {
  it('grants a paid bill: the payment is paid and paidUntil moves a month from now', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1'), { now: NOW });

    expect(outcome).toEqual({ kind: 'granted', paidUntil: ONE_MONTH });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
    expect(await paymentRow(payment.id)).toEqual({ status: 'PAID', paidAt: NOW, grantedUntil: ONE_MONTH });
  });

  it('stacks an annual payment on a paidUntil still in the future', async () => {
    const future = new Date('2026-10-01T00:00:00.000Z');
    const pageId = await aPage(future);
    await aPendingPayment(pageId, 'bill-1', 'ANNUAL');

    await grantPayment(prisma, paid('bill-1', { paidAmount: 39000 }), { now: NOW });

    expect((await pageRow(pageId)).paidUntil).toEqual(new Date('2027-10-01T00:00:00.000Z'));
  });

  it('does nothing for a bill that is not paid', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { paid: false, state: 'due' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'not-paid' });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a bill it never created', async () => {
    expect(await grantPayment(prisma, paid('bill-nobody-made'), { now: NOW })).toEqual({ kind: 'unknown-bill' });
  });

  it('refuses a bill from another collection', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { collectionId: 'col-other' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'collection' });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a paid amount that is not what was billed', async () => {
    // The invoice project's bug: a RM1 bill marking a RM5000 invoice paid.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { paidAmount: 100 }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'amount' });
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a fetched bill whose reference is not this payment', async () => {
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { reference1: 'someone-else' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'reference' });
  });

  it('accepts a fetched bill whose reference is this payment', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { reference1: payment.id }), { now: NOW });

    expect(outcome.kind).toBe('granted');
  });

  it('grants once when the same bill arrives twice', async () => {
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    await grantPayment(prisma, paid('bill-1'), { now: NOW });
    const second = await grantPayment(prisma, paid('bill-1'), { now: NOW });

    expect(second).toEqual({ kind: 'already-granted' });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
  });

  it('grants once when the same bill arrives twice at once', async () => {
    // The callback and the redirect racing each other for one bill.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcomes = await Promise.all([
      grantPayment(prisma, paid('bill-1'), { now: NOW }),
      grantPayment(prisma, paid('bill-1'), { now: NOW }),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['already-granted', 'granted']);
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
  });

  it('extends twice when two payments for one page land together', async () => {
    // Deterministic, not probabilistic. Payment A pauses between reading paidUntil and
    // writing it, and B starts during that pause. With the page lock, B waits on the
    // row and reads A's result. Without it, B reads the old paidUntil and one paid
    // month is lost -- on every run, not occasionally.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-a');
    await aPendingPayment(pageId, 'bill-b');

    let signalRead = () => {};
    const aHasRead = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    let release = () => {};
    const aMayWrite = new Promise<void>((resolve) => {
      release = resolve;
    });

    const grantA = grantPayment(prisma, paid('bill-a'), {
      now: NOW,
      afterRead: async () => {
        signalRead();
        await aMayWrite;
      },
    });
    await aHasRead;
    const grantB = grantPayment(prisma, paid('bill-b'), { now: NOW });
    // Long enough for B to finish outright if nothing makes it wait.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await Promise.all([grantA, grantB]);

    expect((await pageRow(pageId)).paidUntil).toEqual(
      extendPaidUntil({ paidUntil: ONE_MONTH, now: NOW, plan: 'MONTHLY' }),
    );
  });
});

describe('evidenceFromCallback', () => {
  it('reads the callback’s strings, with no reference because it carries none', () => {
    const evidence = evidenceFromCallback({
      id: 'bill-1',
      collection_id: 'col-test',
      paid: 'true',
      state: 'paid',
      paid_amount: '3900',
      x_signature: 'ignored',
    });

    expect(evidence).toEqual({ billId: 'bill-1', collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900 });
    expect(evidence).not.toHaveProperty('reference1');
  });

  it('treats a paid amount that is not whole cents as matching nothing', () => {
    expect(Number.isNaN(evidenceFromCallback({ paid_amount: '39.00' }).paidAmount)).toBe(true);
  });
});

describe('evidenceFromBill', () => {
  it('carries the reference a fetched bill has', () => {
    expect(
      evidenceFromBill({
        id: 'bill-1',
        collectionId: 'col-test',
        paid: true,
        state: 'paid',
        amount: 3900,
        paidAmount: 3900,
        reference1: 'pay-1',
        url: 'https://www.billplz-sandbox.com/bills/bill-1',
      }),
    ).toEqual({ billId: 'bill-1', collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900, reference1: 'pay-1' });
  });
});

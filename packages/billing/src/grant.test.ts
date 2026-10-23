import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extendPaidUntil } from '@curios/core';
import { PrismaClient } from '@curios/db';
import type { ChipPurchase } from './client.js';
import {
  evidenceFromPurchase,
  grantPayment,
  recordRenewalFailure,
  type PaymentEvidence,
} from './grant.js';

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

async function aPendingPayment(
  pageId: string,
  providerRef: string,
  options: { plan?: 'MONTHLY' | 'ANNUAL'; autoRenew?: boolean; autoRenewal?: boolean } = {},
) {
  const plan = options.plan ?? 'MONTHLY';
  return prisma.payment.create({
    data: {
      pageId,
      plan,
      amountCents: plan === 'ANNUAL' ? 39000 : 3900,
      provider: 'CHIP',
      providerRef,
      autoRenew: options.autoRenew ?? false,
      autoRenewal: options.autoRenewal ?? false,
    },
    select: { id: true },
  });
}

function paid(providerRef: string, overrides: Partial<PaymentEvidence> = {}): PaymentEvidence {
  return { providerRef, paid: true, amountCents: 3900, reference: '', card: null, isTest: false, ...overrides };
}

/** The evidence a purchase gives for a payment: its reference is that payment's id. */
function paidFor(payment: { id: string }, providerRef: string, overrides: Partial<PaymentEvidence> = {}) {
  return paid(providerRef, { reference: payment.id, ...overrides });
}

const CARD = { token: 'tok-1', label: 'Visa ending 1111' };

const pageRow = (id: string) =>
  prisma.page.findUniqueOrThrow({ where: { id }, select: { paidUntil: true } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({
    where: { id },
    select: { status: true, paidAt: true, grantedUntil: true },
  });
const cardRow = (pageId: string) => prisma.renewalCard.findUnique({ where: { pageId } });

describe('grantPayment', () => {
  it('grants a paid purchase and extends paidUntil', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1');

    const outcome = await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW });

    expect(outcome).toEqual({ kind: 'granted', paidUntil: ONE_MONTH, cardSaved: false });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
    expect(await paymentRow(payment.id)).toEqual({ status: 'PAID', paidAt: NOW, grantedUntil: ONE_MONTH });
  });

  it('stacks an annual payment on a paidUntil still in the future', async () => {
    const future = new Date('2026-10-01T00:00:00.000Z');
    const pageId = await aPage(future);
    const payment = await aPendingPayment(pageId, 'pur-1', { plan: 'ANNUAL' });

    await grantPayment(prisma, paidFor(payment, 'pur-1', { amountCents: 39000 }), { now: NOW });

    expect((await pageRow(pageId)).paidUntil).toEqual(new Date('2027-10-01T00:00:00.000Z'));
  });

  it('does nothing for a purchase that is not paid', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1');

    const outcome = await grantPayment(prisma, paidFor(payment, 'pur-1', { paid: false }), { now: NOW });

    expect(outcome).toEqual({ kind: 'not-paid' });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('answers unknown-payment for a reference we never created', async () => {
    expect(await grantPayment(prisma, paid('pur-nobody-made'), { now: NOW })).toEqual({
      kind: 'unknown-payment',
    });
  });

  it('refuses an amount or reference that does not match', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1');

    // The invoice project's bug: a RM1 purchase marking a RM5000 invoice paid.
    expect(await grantPayment(prisma, paidFor(payment, 'pur-1', { amountCents: 100 }), { now: NOW })).toEqual({
      kind: 'mismatch',
      reason: 'amount',
    });
    expect(await grantPayment(prisma, paid('pur-1', { reference: 'someone-else' }), { now: NOW })).toEqual({
      kind: 'mismatch',
      reason: 'reference',
    });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('grants once when the same purchase arrives twice', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1');

    await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW });
    const second = await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW });

    expect(second).toEqual({ kind: 'already-granted' });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
  });

  it('grants once when four sources race', async () => {
    // The webhook, the redirect, the hourly check and a retry, all for one purchase.
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1', { autoRenew: true });
    const evidence = paidFor(payment, 'pur-1', { card: CARD });

    const outcomes = await Promise.all(
      [0, 1, 2, 3].map(() => grantPayment(prisma, evidence, { now: NOW })),
    );

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'already-granted',
      'already-granted',
      'already-granted',
      'granted',
    ]);
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
    expect(await prisma.renewalCard.count({ where: { pageId } })).toBe(1);
  });

  it('saves the renewal card when the payment asked for auto-renew and the purchase carries a token', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1', { plan: 'ANNUAL', autoRenew: true });

    const outcome = await grantPayment(
      prisma,
      paidFor(payment, 'pur-1', { amountCents: 39000, card: CARD }),
      { now: NOW },
    );

    expect(outcome).toMatchObject({ kind: 'granted', cardSaved: true });
    expect(await cardRow(pageId)).toMatchObject({
      token: 'tok-1',
      plan: 'ANNUAL',
      cardLabel: 'Visa ending 1111',
      failedAttempts: 0,
      lastFailedAt: null,
    });
  });

  it('saves no card when auto-renew was asked but the purchase has no token', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1', { autoRenew: true });

    const outcome = await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW });

    expect(outcome).toMatchObject({ kind: 'granted', cardSaved: false });
    expect(await cardRow(pageId)).toBeNull();
  });

  it('saves no card when auto-renew was not asked', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1');

    const outcome = await grantPayment(prisma, paidFor(payment, 'pur-1', { card: CARD }), { now: NOW });

    expect(outcome).toMatchObject({ kind: 'granted', cardSaved: false });
    expect(await cardRow(pageId)).toBeNull();
  });

  it("a renewal grant resets the card's failures", async () => {
    const pageId = await aPage();
    await prisma.renewalCard.create({
      data: { pageId, token: 'tok-1', plan: 'MONTHLY', failedAttempts: 2, lastFailedAt: NOW },
    });
    const payment = await aPendingPayment(pageId, 'pur-1', { autoRenewal: true });

    const outcome = await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW });

    expect(outcome).toMatchObject({ kind: 'granted', cardSaved: false });
    expect(await cardRow(pageId)).toMatchObject({ failedAttempts: 0, lastFailedAt: null });
  });

  it("any grant ends a run of failures, a payment by hand included", async () => {
    // Paid at checkout after a decline: Billing must stop saying the last renewal failed,
    // and the next period must start counting from zero.
    const pageId = await aPage();
    await prisma.renewalCard.create({
      data: { pageId, token: 'tok-1', plan: 'MONTHLY', failedAttempts: 2, lastFailedAt: NOW },
    });
    const payment = await aPendingPayment(pageId, 'pur-1');

    expect(await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW })).toMatchObject({ kind: 'granted' });
    expect(await cardRow(pageId)).toMatchObject({ token: 'tok-1', failedAttempts: 0, lastFailedAt: null });
  });

  describe('a test purchase', () => {
    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnv;
    });

    it('is refused in production, and nothing is granted', async () => {
      // A test key in production must never hand out paid time.
      process.env.NODE_ENV = 'production';
      const pageId = await aPage();
      const payment = await aPendingPayment(pageId, 'pur-1');

      expect(await grantPayment(prisma, paidFor(payment, 'pur-1', { isTest: true }), { now: NOW })).toEqual({
        kind: 'test-purchase',
      });
      expect((await paymentRow(payment.id)).status).toBe('PENDING');
      expect((await pageRow(pageId)).paidUntil).toBeNull();
    });

    it('is granted outside production', async () => {
      process.env.NODE_ENV = 'test';
      const pageId = await aPage();
      const payment = await aPendingPayment(pageId, 'pur-1');

      expect(await grantPayment(prisma, paidFor(payment, 'pur-1', { isTest: true }), { now: NOW })).toMatchObject({
        kind: 'granted',
      });
    });
  });

  it.each(['FAILED', 'EXPIRED'] as const)(
    'answers paid-after-failure for a paid purchase whose payment is %s, and grants nothing',
    async (status) => {
      // Money taken with no time given: a person has to look, so it must not read as a repeat.
      const pageId = await aPage();
      const payment = await aPendingPayment(pageId, 'pur-1', { autoRenewal: true });
      await prisma.payment.update({ where: { id: payment.id }, data: { status } });

      expect(await grantPayment(prisma, paidFor(payment, 'pur-1'), { now: NOW })).toEqual({
        kind: 'paid-after-failure',
      });
      expect((await paymentRow(payment.id)).status).toBe(status);
      expect((await pageRow(pageId)).paidUntil).toBeNull();
    },
  );

  it("a second payment reads the first's paidUntil", async () => {
    // Deterministic, not probabilistic. Payment A pauses between reading paidUntil and
    // writing it, and B starts during that pause. With the page lock, B waits on the
    // row and reads A's result. Without it, B reads the old paidUntil and one paid
    // month is lost -- on every run, not occasionally.
    const pageId = await aPage();
    const a = await aPendingPayment(pageId, 'pur-a');
    const b = await aPendingPayment(pageId, 'pur-b');

    let signalRead = () => {};
    const aHasRead = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    let release = () => {};
    const aMayWrite = new Promise<void>((resolve) => {
      release = resolve;
    });

    const grantA = grantPayment(prisma, paidFor(a, 'pur-a'), {
      now: NOW,
      afterRead: async () => {
        signalRead();
        await aMayWrite;
      },
    });
    await aHasRead;
    const grantB = grantPayment(prisma, paidFor(b, 'pur-b'), { now: NOW });
    // Long enough for B to finish outright if nothing makes it wait.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await Promise.all([grantA, grantB]);

    expect((await pageRow(pageId)).paidUntil).toEqual(
      extendPaidUntil({ paidUntil: ONE_MONTH, now: NOW, plan: 'MONTHLY' }),
    );
  });
});

describe('recordRenewalFailure', () => {
  async function aRenewal(paidUntil: Date | null) {
    const pageId = await aPage(paidUntil);
    await prisma.renewalCard.create({ data: { pageId, token: 'tok-1', plan: 'MONTHLY' } });
    const payment = await aPendingPayment(pageId, 'pur-first', { autoRenewal: true });
    return { pageId, payment };
  }

  it('counts, then stops at three', async () => {
    const { pageId, payment } = await aRenewal(new Date('2026-09-15T00:00:00.000Z'));

    expect(await recordRenewalFailure(prisma, payment.id, NOW)).toEqual({ kind: 'retry', attempts: 1 });
    expect(await cardRow(pageId)).toMatchObject({ failedAttempts: 1, lastFailedAt: NOW });
    expect((await paymentRow(payment.id)).status).toBe('FAILED');

    const second = await aPendingPayment(pageId, 'pur-second', { autoRenewal: true });
    expect(await recordRenewalFailure(prisma, second.id, NOW)).toEqual({ kind: 'retry', attempts: 2 });

    const third = await aPendingPayment(pageId, 'pur-third', { autoRenewal: true });
    expect(await recordRenewalFailure(prisma, third.id, NOW)).toEqual({ kind: 'stopped', reason: 'attempts' });
    expect(await cardRow(pageId)).toBeNull();
  });

  it('stops once paidUntil is more than 3 days past', async () => {
    const { pageId, payment } = await aRenewal(new Date('2026-09-10T00:00:00.000Z'));

    expect(await recordRenewalFailure(prisma, payment.id, NOW)).toEqual({ kind: 'stopped', reason: 'lapsed' });
    expect(await cardRow(pageId)).toBeNull();
    expect((await paymentRow(payment.id)).status).toBe('FAILED');
  });

  it('ignores a payment already failed or paid', async () => {
    const { pageId, payment } = await aRenewal(new Date('2026-09-15T00:00:00.000Z'));
    await recordRenewalFailure(prisma, payment.id, NOW);

    expect(await recordRenewalFailure(prisma, payment.id, NOW)).toEqual({ kind: 'ignored' });
    expect(await cardRow(pageId)).toMatchObject({ failedAttempts: 1 });

    const paidOne = await aPendingPayment(pageId, 'pur-paid', { autoRenewal: true });
    await grantPayment(prisma, paidFor(paidOne, 'pur-paid'), { now: NOW });
    expect(await recordRenewalFailure(prisma, paidOne.id, NOW)).toEqual({ kind: 'ignored' });
  });

  it('ignores a payment that is not a renewal, and does not claim it', async () => {
    const pageId = await aPage(new Date('2026-09-15T00:00:00.000Z'));
    await prisma.renewalCard.create({ data: { pageId, token: 'tok-1', plan: 'MONTHLY' } });
    const checkout = await aPendingPayment(pageId, 'pur-checkout');

    expect(await recordRenewalFailure(prisma, checkout.id, NOW)).toEqual({ kind: 'ignored' });
    expect((await paymentRow(checkout.id)).status).toBe('PENDING');
    expect(await cardRow(pageId)).toMatchObject({ failedAttempts: 0 });
  });

  it('counts both of two failures reported at once', async () => {
    // The card row is locked while it is counted, so the second waits and reads the first's count.
    const { pageId, payment } = await aRenewal(new Date('2026-09-15T00:00:00.000Z'));
    const other = await aPendingPayment(pageId, 'pur-other', { autoRenewal: true });

    const results = await Promise.all([
      recordRenewalFailure(prisma, payment.id, NOW),
      recordRenewalFailure(prisma, other.id, NOW),
    ]);

    expect(results.map((result) => (result.kind === 'retry' ? result.attempts : 0)).sort()).toEqual([1, 2]);
    expect(await cardRow(pageId)).toMatchObject({ failedAttempts: 2 });
  });

  it('does not throw when the owner turns auto-renew off as a failure is counted', async () => {
    const { pageId, payment } = await aRenewal(new Date('2026-09-15T00:00:00.000Z'));

    const [result] = await Promise.all([
      recordRenewalFailure(prisma, payment.id, NOW),
      prisma.renewalCard.deleteMany({ where: { pageId } }),
    ]);

    expect(['retry', 'ignored']).toContain(result.kind);
    expect((await paymentRow(payment.id)).status).toBe('FAILED');
    expect(await cardRow(pageId)).toBeNull();
  });

  it('claims the payment but ignores a page whose card is already gone', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'pur-1', { autoRenewal: true });

    expect(await recordRenewalFailure(prisma, payment.id, NOW)).toEqual({ kind: 'ignored' });
    expect((await paymentRow(payment.id)).status).toBe('FAILED');
  });
});

describe('evidenceFromPurchase', () => {
  const purchase: ChipPurchase = {
    id: 'pur-1',
    status: 'paid',
    reference: 'pay-1',
    totalCents: 3900,
    checkoutUrl: 'https://gate.chip-in.asia/p/pur-1/',
    isRecurringToken: true,
    isTest: true,
    paymentMethod: 'visa',
    maskedPan: '411111******1111',
  };

  it('reads a paid purchase, with the card it saved labelled for the owner', () => {
    expect(evidenceFromPurchase(purchase)).toEqual({
      providerRef: 'pur-1',
      paid: true,
      amountCents: 3900,
      reference: 'pay-1',
      card: { token: 'pur-1', label: 'Visa ending 1111' },
      isTest: true,
    });
  });

  it('carries no card unless one was saved, and no label unless it is known', () => {
    expect(evidenceFromPurchase({ ...purchase, isRecurringToken: false }).card).toBeNull();
    expect(evidenceFromPurchase({ ...purchase, maskedPan: null }).card).toEqual({ token: 'pur-1', label: null });
    expect(evidenceFromPurchase({ ...purchase, paymentMethod: null }).card?.label).toBeNull();
    expect(evidenceFromPurchase({ ...purchase, status: 'created' }).paid).toBe(false);
    // A card purchase CHIP has since cleared or settled is still paid.
    expect(evidenceFromPurchase({ ...purchase, status: 'cleared' }).paid).toBe(true);
    expect(evidenceFromPurchase({ ...purchase, status: 'settled' }).paid).toBe(true);
  });
});

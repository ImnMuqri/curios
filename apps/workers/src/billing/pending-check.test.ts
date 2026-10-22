import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { ChipClient, ChipPurchase } from '@curios/billing';
import {
  PENDING_MAX_AGE_MS,
  PENDING_MIN_AGE_MS,
  runPendingCheck,
  scheduleBillingJobs,
  type SchedulerQueue,
} from './pending-check.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-14T08:00:00.000Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let pageId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const skeleton = `pc-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `pending-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';
});

async function aPayment(
  createdAt: Date,
  options: { ref?: string | null; status?: 'PENDING' | 'PAID'; autoRenewal?: boolean; provider?: 'CHIP' | 'BILLPLZ' } = {},
) {
  const ref = options.ref === undefined ? `purchase-${randomUUID()}` : options.ref;
  const payment = await prisma.payment.create({
    data: {
      pageId,
      plan: 'MONTHLY',
      amountCents: 4900,
      provider: options.provider ?? 'CHIP',
      providerRef: ref,
      status: options.status ?? 'PENDING',
      autoRenewal: options.autoRenewal ?? false,
      createdAt,
    },
  });
  return { ref: ref ?? '', id: payment.id };
}

const statusOf = async (id: string) => (await prisma.payment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

function aPurchase(over: Partial<ChipPurchase> & { id: string }): ChipPurchase {
  return {
    status: 'created',
    reference: '',
    totalCents: 4900,
    checkoutUrl: `https://gate.chip-in.asia/p/${over.id}/`,
    isRecurringToken: false,
    isTest: true,
    paymentMethod: null,
    maskedPan: null,
    ...over,
  };
}

/** A CHIP that says every purchase it is asked about has been paid, for exactly what was billed. */
function aPayingClient() {
  return {
    createPurchase: vi.fn<ChipClient['createPurchase']>(),
    chargePurchase: vi.fn<ChipClient['chargePurchase']>(),
    deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
    cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
    getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
    getPurchase: vi.fn<ChipClient['getPurchase']>(async (id): Promise<ChipPurchase> => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { providerRef: id }, select: { id: true } });
      return aPurchase({ id, status: 'paid', reference: payment.id });
    }),
  };
}

describe('runPendingCheck', () => {
  it('grants a paid purchase whose callbacks never arrived', async () => {
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();

    const result = await runPendingCheck({ prisma, client, now: NOW });

    expect(result).toEqual({ checked: 1, granted: 1, expired: 0 });
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } });
    expect(page.paidUntil).not.toBeNull();
  });

  it.each(['expired', 'cancelled', 'error', 'blocked'])('marks a %s purchase EXPIRED', async (status) => {
    const payment = await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getPurchase.mockResolvedValueOnce(aPurchase({ id: payment.ref, status, reference: payment.id }));

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 1, granted: 0, expired: 1 });
    expect(await statusOf(payment.id)).toBe('EXPIRED');
  });

  it('never overwrites a payment that was paid after the read', async () => {
    const payment = await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getPurchase.mockImplementationOnce(async (id) => {
      // The webhook lands between the check's read and its write.
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } });
      return aPurchase({ id, status: 'expired', reference: payment.id });
    });

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 1, granted: 0, expired: 0 });
    expect(await statusOf(payment.id)).toBe('PAID');
  });

  it('leaves a purchase still open alone', async () => {
    const payment = await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getPurchase.mockResolvedValueOnce(aPurchase({ id: payment.ref, status: 'created', reference: payment.id }));

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 1, granted: 0, expired: 0 });
    expect(await statusOf(payment.id)).toBe('PENDING');
  });

  it('skips renewal payments, which the auto-renew job owns', async () => {
    await aPayment(ago(3 * HOUR_MS), { autoRenewal: true });
    const client = aPayingClient();

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 0, granted: 0, expired: 0 });
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('skips a Billplz payment, which CHIP knows nothing about', async () => {
    await aPayment(ago(3 * HOUR_MS), { provider: 'BILLPLZ' });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('checks a payment exactly two hours old', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).toHaveBeenCalledTimes(1);
  });

  it('leaves a payment a minute younger than that to its callback', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS - MINUTE_MS));
    const client = aPayingClient();

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 0, granted: 0, expired: 0 });
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('still checks a payment exactly seven days old', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).toHaveBeenCalledTimes(1);
  });

  it('stops checking a payment a minute older than that', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS + MINUTE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('skips a payment that never got a purchase id', async () => {
    await aPayment(ago(3 * HOUR_MS), { ref: null });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('never asks about a payment already paid', async () => {
    await aPayment(ago(3 * HOUR_MS), { status: 'PAID' });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('one purchase failing does not stop the rest', async () => {
    // Oldest first: the four-hour-old payment is asked about first, and fails.
    await aPayment(ago(4 * HOUR_MS));
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getPurchase.mockRejectedValueOnce(new Error('CHIP unreachable'));

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 2, granted: 1, expired: 0 });
  });
});

describe('scheduleBillingJobs', () => {
  it('schedules the pending check hourly, under a fixed id', async () => {
    const queue = { upsertJobScheduler: vi.fn<SchedulerQueue['upsertJobScheduler']>(async () => ({})) };

    await scheduleBillingJobs(queue);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'pending-check',
      { pattern: '0 * * * *' },
      { name: 'pending-check' },
    );
  });

  it('schedules the reminder daily at 10:00 Malaysian time', async () => {
    // Without the zone, BullMQ reads the pattern in the server's own zone, and
    // an email meant for mid-morning arrives at 6pm or at 2am.
    const queue = { upsertJobScheduler: vi.fn<SchedulerQueue['upsertJobScheduler']>(async () => ({})) };

    await scheduleBillingJobs(queue);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'renewal-reminder',
      { pattern: '0 10 * * *', tz: 'Asia/Kuala_Lumpur' },
      { name: 'renewal-reminder' },
    );
  });
});

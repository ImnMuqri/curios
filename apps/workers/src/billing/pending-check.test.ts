import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { BillplzBill, BillplzClient } from '@curios/billing';
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

async function aPayment(createdAt: Date, options: { billId?: string | null; status?: 'PENDING' | 'PAID' } = {}) {
  const billId = options.billId === undefined ? `bill-${randomUUID()}` : options.billId;
  await prisma.payment.create({
    data: {
      pageId,
      plan: 'MONTHLY',
      amountCents: 3900,
      billplzCollectionId: 'col-test',
      billplzBillId: billId,
      status: options.status ?? 'PENDING',
      createdAt,
    },
  });
  return billId;
}

/** A Billplz that says every bill it is asked about has been paid, for exactly what was billed. */
function aPayingClient() {
  return {
    createBill: vi.fn<BillplzClient['createBill']>(),
    getBill: vi.fn<BillplzClient['getBill']>(async (id): Promise<BillplzBill> => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { billplzBillId: id }, select: { id: true } });
      return {
        id,
        collectionId: 'col-test',
        paid: true,
        state: 'paid',
        amount: 3900,
        paidAmount: 3900,
        reference1: payment.id,
        url: `https://www.billplz-sandbox.com/bills/${id}`,
      };
    }),
  };
}

describe('runPendingCheck', () => {
  it('grants a payment whose callbacks never arrived', async () => {
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();

    const result = await runPendingCheck({ prisma, client, now: NOW });

    expect(result).toEqual({ checked: 1, granted: 1 });
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } });
    expect(page.paidUntil).not.toBeNull();
  });

  it('checks a payment exactly two hours old', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).toHaveBeenCalledTimes(1);
  });

  it('leaves a payment a minute younger than that to its callback', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS - MINUTE_MS));
    const client = aPayingClient();

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 0, granted: 0 });
    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('still checks a payment exactly seven days old', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).toHaveBeenCalledTimes(1);
  });

  it('stops checking a payment a minute older than that', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS + MINUTE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('skips a payment that never got a bill id', async () => {
    await aPayment(ago(3 * HOUR_MS), { billId: null });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('never asks about a payment already paid', async () => {
    await aPayment(ago(3 * HOUR_MS), { status: 'PAID' });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('keeps going when one bill cannot be fetched', async () => {
    // Oldest first: the four-hour-old payment is asked about first, and fails.
    await aPayment(ago(4 * HOUR_MS));
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getBill.mockRejectedValueOnce(new Error('Billplz unreachable'));

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 2, granted: 1 });
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

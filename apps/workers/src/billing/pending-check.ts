import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { BILLING_QUEUE, PENDING_CHECK_JOB, RENEWAL_REMINDER_JOB } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { evidenceFromBill, grantPayment, type BillplzClient } from '@curios/billing';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runPlanEndedMails, runRenewalReminders, type MailQueueLike } from './renewal-reminder.js';

const HOUR_MS = 60 * 60 * 1000;

/** Younger than this, the callback may simply not have arrived yet. */
export const PENDING_MIN_AGE_MS = 2 * HOUR_MS;

/**
 * Older than this, the payment is left alone. An unpaid bill ages out by itself, and a
 * callback dropped after Billplz's fifth attempt -- about 24 hours after the first -- is
 * still well inside the window.
 */
export const PENDING_MAX_AGE_MS = 7 * 24 * HOUR_MS;

export interface BillingLog {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
}

export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz?: string },
    template: { name: string },
  ): Promise<unknown>;
}

/**
 * Asks Billplz about payments still pending, and grants the ones it says were paid.
 *
 * This exists because of the fifth attempt. If every callback fails -- the API down for
 * a day -- Billplz stops, and without this an owner who has paid never gets it.
 */
export async function runPendingCheck(deps: {
  prisma: PrismaClient;
  client: BillplzClient;
  now: Date;
  log?: BillingLog;
}): Promise<{ checked: number; granted: number }> {
  const stale = await deps.prisma.payment.findMany({
    where: {
      status: 'PENDING',
      billplzBillId: { not: null },
      createdAt: {
        gte: new Date(deps.now.getTime() - PENDING_MAX_AGE_MS),
        lte: new Date(deps.now.getTime() - PENDING_MIN_AGE_MS),
      },
    },
    select: { billplzBillId: true },
    orderBy: { createdAt: 'asc' },
  });

  let granted = 0;
  for (const { billplzBillId } of stale) {
    if (!billplzBillId) continue;
    try {
      const bill = await deps.client.getBill(billplzBillId);
      const outcome = await grantPayment(deps.prisma, evidenceFromBill(bill), { now: deps.now });
      if (outcome.kind === 'granted') {
        granted += 1;
        deps.log?.info({ billId: billplzBillId }, 'pending payment granted by the hourly check');
      } else if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-bill') {
        deps.log?.error({ billId: billplzBillId, outcome: outcome.kind }, 'pending payment refused by the hourly check');
      }
    } catch (error) {
      // One bill failing -- Billplz briefly unreachable, say -- must not stop the rest.
      deps.log?.error({ billId: billplzBillId, err: String(error) }, 'hourly check could not confirm a bill');
    }
  }

  return { checked: stale.length, granted };
}

export function createBillingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  client: BillplzClient;
  mailQueue: MailQueueLike;
  appUrl: string;
  log?: BillingLog;
}): Worker {
  return new Worker(
    BILLING_QUEUE,
    async (job) => {
      if (job.name === PENDING_CHECK_JOB) {
        await runPendingCheck({ prisma: deps.prisma, client: deps.client, now: new Date(), log: deps.log });
      }
      if (job.name === RENEWAL_REMINDER_JOB) {
        await runRenewalReminders({
          prisma: deps.prisma,
          mailQueue: deps.mailQueue,
          now: new Date(),
          appUrl: deps.appUrl,
          log: deps.log,
        });
        // The same daily run tells owners whose plan has just ended.
        await runPlanEndedMails({
          prisma: deps.prisma,
          mailQueue: deps.mailQueue,
          now: new Date(),
          appUrl: deps.appUrl,
          log: deps.log,
        });
      }
    },
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.billing },
  );
}

/** Upserted under fixed ids, so a restart replaces the schedules instead of adding more. */
export async function scheduleBillingJobs(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(PENDING_CHECK_JOB, { pattern: '0 * * * *' }, { name: PENDING_CHECK_JOB });
  // 10:00 in Malaysia, named explicitly: without `tz` BullMQ reads the pattern
  // in the server's zone, and a mid-morning email arrives at 2am.
  await queue.upsertJobScheduler(
    RENEWAL_REMINDER_JOB,
    { pattern: '0 10 * * *', tz: 'Asia/Kuala_Lumpur' },
    { name: RENEWAL_REMINDER_JOB },
  );
}

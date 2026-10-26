import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { BILLING_QUEUE, PENDING_CHECK_JOB, RENEWAL_REMINDER_JOB } from '@curios/core';
import type { Settings } from '@curios/core/settings';
import type { PrismaClient } from '@curios/db';
import { DEAD_PURCHASE_STATUSES, evidenceFromPurchase, grantPayment, type ChipClient } from '@curios/billing';
import { errName, runAutoRenewals } from './auto-renew.js';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runPlanEndedMails, runRenewalReminders, type MailQueueLike } from './renewal-reminder.js';

const HOUR_MS = 60 * 60 * 1000;

/** Younger than this, the callback may simply not have arrived yet. */
export const PENDING_MIN_AGE_MS = 2 * HOUR_MS;

/**
 * Older than this, the payment is left alone. An unpaid purchase ages out by itself, and a
 * webhook dropped for a day or two is still well inside the window.
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
 * Asks CHIP about payments still pending, grants the ones it says were paid, and
 * marks the ones it says can no longer be paid.
 *
 * This exists because a webhook can be lost. If the API is down when CHIP calls, and
 * the owner closes the tab before the redirect, without this an owner who has paid
 * never gets it.
 *
 * Renewal payments are left out: the auto-renew job charges and settles those itself.
 *
 * A Billplz payment still PENDING from before the cutover to CHIP is never granted by
 * anything here -- nothing asks Billplz any more -- so while one is young enough to be
 * paid yet, each run names it at error level for a person to settle (devDocs/OPERATIONS.md,
 * "Cutting over from Billplz").
 */
export async function runPendingCheck(deps: {
  prisma: PrismaClient;
  client: ChipClient;
  now: Date;
  log?: BillingLog;
}): Promise<{ checked: number; granted: number; expired: number }> {
  const stale = await deps.prisma.payment.findMany({
    where: {
      status: 'PENDING',
      provider: 'CHIP',
      providerRef: { not: null },
      autoRenewal: false,
      createdAt: {
        gte: new Date(deps.now.getTime() - PENDING_MAX_AGE_MS),
        lte: new Date(deps.now.getTime() - PENDING_MIN_AGE_MS),
      },
    },
    select: { id: true, providerRef: true },
    orderBy: { createdAt: 'asc' },
  });

  const billplz = await deps.prisma.payment.findMany({
    where: {
      status: 'PENDING',
      provider: 'BILLPLZ',
      createdAt: { gte: new Date(deps.now.getTime() - PENDING_MAX_AGE_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (billplz.length > 0) {
    deps.log?.error(
      { paymentIds: billplz.map((payment) => payment.id) },
      'billplz payments still pending since the cutover; settle them by hand (devDocs/OPERATIONS.md)',
    );
  }

  let granted = 0;
  let expired = 0;
  for (const { id, providerRef } of stale) {
    if (!providerRef) continue;
    try {
      const purchase = await deps.client.getPurchase(providerRef);
      const outcome = await grantPayment(deps.prisma, evidenceFromPurchase(purchase), { now: deps.now });
      if (outcome.kind === 'granted') {
        granted += 1;
        deps.log?.info({ purchaseId: providerRef }, 'pending payment granted by the hourly check');
      } else if (
        outcome.kind === 'mismatch' ||
        outcome.kind === 'unknown-payment' ||
        // Paid after it was marked failed or expired: money taken, no time given.
        outcome.kind === 'paid-after-failure' ||
        // A test key in production: no money moved, and no time is given.
        outcome.kind === 'test-purchase'
      ) {
        deps.log?.error({ purchaseId: providerRef, outcome: outcome.kind }, 'pending payment refused by the hourly check');
      } else if (outcome.kind === 'not-paid' && DEAD_PURCHASE_STATUSES.has(purchase.status)) {
        // Conditional, so a webhook that paid this row since the read above is never overwritten.
        const marked = await deps.prisma.payment.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        expired += marked.count;
      }
    } catch (error) {
      // One purchase failing -- CHIP briefly unreachable, say -- must not stop the rest.
      deps.log?.error({ purchaseId: providerRef, err: errName(error) }, 'hourly check could not confirm a purchase');
    }
  }

  return { checked: stale.length, granted, expired };
}

export function createBillingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  client: ChipClient;
  mailQueue: MailQueueLike;
  appUrl: string;
  /** The API's public origin, for the renewal purchases' callback. */
  callbackBaseUrl: string;
  log?: BillingLog;
  /** The admin's settings, read at the start of each daily run. */
  settings: { get(): Promise<Settings> };
}): Worker {
  return new Worker(
    BILLING_QUEUE,
    async (job) => {
      if (job.name === PENDING_CHECK_JOB) {
        await runPendingCheck({ prisma: deps.prisma, client: deps.client, now: new Date(), log: deps.log });
      }
      if (job.name === RENEWAL_REMINDER_JOB) {
        // Charged first, so a page renewed this morning is not then told its plan ends.
        // Its failure is kept until the emails below have gone, so one cannot stop the other.
        let renewalError: Error | undefined;
        try {
          const renewed = await runAutoRenewals({
            prisma: deps.prisma,
            client: deps.client,
            mailQueue: deps.mailQueue,
            now: new Date(),
            appUrl: deps.appUrl,
            callbackBaseUrl: deps.callbackBaseUrl,
            log: deps.log,
            settings: await deps.settings.get(),
          });
          deps.log?.info(renewed, 'auto-renew run finished');
        } catch (error) {
          renewalError = error instanceof Error ? error : new Error(String(error));
        }
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
        if (renewalError) throw renewalError;
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

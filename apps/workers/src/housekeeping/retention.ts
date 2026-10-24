import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { HOUSEKEEPING_QUEUE, LEAD_RETENTION_MONTHS, RETENTION_JOB, type MailJobData } from '@curios/core';
import type { Prisma, PrismaClient } from '@curios/db';
import { QUEUE_CONCURRENCY } from '../queues.js';
import type { SchedulerQueue } from '../billing/pending-check.js';
import type { RemoveObjects } from '../lib/storage.js';
import { EXPIRE_HOLDS_JOB, expireUnpaidHolds } from './expire-holds.js';
import { SESSION_REMINDERS_JOB, sendSessionReminders } from './session-reminders.js';

/** The moment before which a lead or a message is past keeping. */
export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LEAD_RETENTION_MONTHS);
  return cutoff;
}

/** How many old orders one sweep step reads, removes and deletes: far under Postgres's bind-parameter limit. */
export const RETENTION_BATCH = 500;

type RetentionLog = { warn: (details: object, message: string) => void; error?: (details: object, message: string) => void };

/**
 * BACKEND.md's PDPA promise, kept: leads, orders and the messages of
 * conversations are deleted outright once they are twelve months old, and a
 * conversation left with nothing in it goes with them. An order's receipt is
 * a customer's bank screenshot, so its file goes first and the row after: an
 * order whose file will not delete keeps its row, and with it the key, so the
 * next night's sweep tries again (deleting a key already gone succeeds, so a
 * retry is safe). A row is deleted only while its key is still the one whose
 * file went, so a receipt uploaded mid-sweep is never orphaned. With storage
 * off (`removeObjects` null) nothing was stored, and every old order goes.
 *
 * Orders are swept `batchSize` at a time by id, so a year of orders never
 * becomes one query past the bind-parameter limit. Each kind is its own step,
 * and a step that fails is logged and does not skip the others: storage being
 * down must not keep a visitor's messages past their year. The sweep throws
 * the first failure after every step has run, so the job is marked failed.
 *
 * What the owner sees as statistics -- the questions and how often they were
 * asked, the topics, their answers -- is the page's own knowledge rather than
 * a visitor's record, and stays. ModelCall keeps its conversation id as a
 * plain string (no foreign key), so its cost history is untouched.
 */
export async function runRetention(deps: {
  prisma: PrismaClient;
  now: Date;
  removeObjects?: RemoveObjects | null;
  log?: RetentionLog;
  batchSize?: number;
}): Promise<{ leads: number; messages: number; conversations: number; orders: number; receipts: number }> {
  const before = retentionCutoff(deps.now);
  const failures: unknown[] = [];
  const step = async (name: string, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (error) {
      failures.push(error);
      (deps.log?.error ?? deps.log?.warn)?.({ step: name, err: String(error) }, 'retention step failed; the other steps still ran');
      return 0;
    }
  };

  // Messages before conversations, which go only once emptied; orders last, so
  // storage trouble in their sweep comes after everything else is done.
  const leads = await step('leads', async () => (await deps.prisma.lead.deleteMany({ where: { createdAt: { lt: before } } })).count);
  const messages = await step('messages', async () => (await deps.prisma.message.deleteMany({ where: { createdAt: { lt: before } } })).count);
  const conversations = await step(
    'conversations',
    async () => (await deps.prisma.conversation.deleteMany({ where: { createdAt: { lt: before }, messages: { none: {} }, lead: null } })).count,
  );
  let receipts = 0;
  const orders = await step('orders', () =>
    sweepOrders(deps, before, deps.batchSize ?? RETENTION_BATCH, (removed) => {
      receipts += removed;
    }),
  );

  if (failures.length > 0) throw failures[0];
  return { leads, messages, conversations, orders, receipts };
}

/** The old orders, a batch at a time by id: files first, then the rows whose files went. */
async function sweepOrders(
  deps: { prisma: PrismaClient; removeObjects?: RemoveObjects | null; log?: RetentionLog },
  before: Date,
  batchSize: number,
  countReceipts: (removed: number) => void,
): Promise<number> {
  // Lines go with their order (onDelete: Cascade); a conversation waiting on one is let go of (SetNull).
  let orders = 0;
  let after: string | undefined;
  for (;;) {
    const old = await deps.prisma.order.findMany({
      where: { createdAt: { lt: before }, ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, receiptKey: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (old.length === 0) break;
    after = old[old.length - 1]!.id;

    const ids = old.map((order) => order.id);
    // Deleting an order frees the codes on its lines (SetNull) and removes its class bookings
    // (Cascade): right for an order never paid. A paid order's code was given to its buyer, so
    // it goes with the order instead of becoming a free code for the next one.
    const deleteOrders = async (where: Prisma.OrderWhereInput): Promise<number> => {
      const [, deleted] = await deps.prisma.$transaction([
        deps.prisma.itemCode.deleteMany({ where: { orderLine: { order: { ...where, paidAt: { not: null } } } } }),
        deps.prisma.order.deleteMany({ where }),
      ]);
      return deleted.count;
    };
    if (!deps.removeObjects) {
      orders += await deleteOrders({ id: { in: ids }, createdAt: { lt: before } });
    } else {
      const keys = old.flatMap((order) => (order.receiptKey ? [order.receiptKey] : []));
      const { failed } = keys.length > 0 ? await deps.removeObjects(keys) : { failed: [] };
      if (failed.length > 0) deps.log?.warn({ failed }, 'retention could not remove some receipt files; their orders wait for the next sweep');
      const removed = keys.filter((key) => !failed.includes(key));
      countReceipts(removed.length);
      const bare = old.filter((order) => !order.receiptKey).map((order) => order.id);
      orders += await deleteOrders({
        createdAt: { lt: before },
        OR: [{ id: { in: bare }, receiptKey: null }, { id: { in: ids }, receiptKey: { in: removed } }],
      });
    }

    if (old.length < batchSize) break;
  }
  return orders;
}

export function createHousekeepingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  removeObjects: RemoveObjects | null;
  /** The class reminders go out through the mail queue, with order links opened by `secretsKey`. */
  reminders: { mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> }; appUrl: string; secretsKey: Buffer | null };
  log?: { info: (details: object, message: string) => void; warn: (details: object, message: string) => void; error?: (details: object, message: string) => void };
}): Worker {
  return new Worker(
    HOUSEKEEPING_QUEUE,
    async (job) => {
      if (job.name === RETENTION_JOB) {
        const deleted = await runRetention({ prisma: deps.prisma, now: new Date(), removeObjects: deps.removeObjects, log: deps.log });
        deps.log?.info(deleted, 'retention sweep done');
      } else if (job.name === EXPIRE_HOLDS_JOB) {
        await expireUnpaidHolds({ prisma: deps.prisma, now: new Date(), log: deps.log });
      } else if (job.name === SESSION_REMINDERS_JOB) {
        await sendSessionReminders({ prisma: deps.prisma, now: new Date(), log: deps.log, ...deps.reminders });
      }
    },
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.housekeeping },
  );
}

/** 03:00 in Malaysia, when the fewest visitors are mid-conversation. Upserted under a fixed id. */
export async function scheduleHousekeepingJobs(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(RETENTION_JOB, { pattern: '0 3 * * *', tz: 'Asia/Kuala_Lumpur' }, { name: RETENTION_JOB });
  // Hourly: unpaid orders holding codes or class seats are let go of after a day.
  await queue.upsertJobScheduler(EXPIRE_HOLDS_JOB, { pattern: '20 * * * *' }, { name: EXPIRE_HOLDS_JOB });
  // Class reminders for the next Malaysian day, at a civil hour; the claim on each booking makes a re-run harmless.
  await queue.upsertJobScheduler(SESSION_REMINDERS_JOB, { pattern: '0 9 * * *', tz: 'Asia/Kuala_Lumpur' }, { name: SESSION_REMINDERS_JOB });
}

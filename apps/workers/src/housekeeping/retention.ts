import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { HOUSEKEEPING_QUEUE, LEAD_RETENTION_MONTHS, RETENTION_JOB } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { QUEUE_CONCURRENCY } from '../queues.js';
import type { SchedulerQueue } from '../billing/pending-check.js';
import type { RemoveObjects } from '../lib/storage.js';

/** The moment before which a lead or a message is past keeping. */
export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LEAD_RETENTION_MONTHS);
  return cutoff;
}

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
 * What the owner sees as statistics -- the questions and how often they were
 * asked, the topics, their answers -- is the page's own knowledge rather than
 * a visitor's record, and stays. ModelCall keeps its conversation id as a
 * plain string (no foreign key), so its cost history is untouched.
 */
export async function runRetention(deps: {
  prisma: PrismaClient;
  now: Date;
  removeObjects?: RemoveObjects | null;
  log?: { warn: (details: object, message: string) => void };
}): Promise<{ leads: number; messages: number; conversations: number; orders: number; receipts: number }> {
  const before = retentionCutoff(deps.now);
  const leads = await deps.prisma.lead.deleteMany({ where: { createdAt: { lt: before } } });

  // Lines go with their order (onDelete: Cascade); a conversation waiting on one is let go of (SetNull).
  let orders: number;
  let receipts = 0;
  if (!deps.removeObjects) {
    orders = (await deps.prisma.order.deleteMany({ where: { createdAt: { lt: before } } })).count;
  } else {
    const old = await deps.prisma.order.findMany({ where: { createdAt: { lt: before } }, select: { id: true, receiptKey: true } });
    const keys = old.flatMap((order) => (order.receiptKey ? [order.receiptKey] : []));
    const { failed } = keys.length > 0 ? await deps.removeObjects(keys) : { failed: [] };
    if (failed.length > 0) deps.log?.warn({ failed }, 'retention could not remove some receipt files; their orders wait for the next sweep');
    const removed = keys.filter((key) => !failed.includes(key));
    receipts = removed.length;
    const bare = old.filter((order) => !order.receiptKey).map((order) => order.id);
    orders = (
      await deps.prisma.order.deleteMany({
        where: {
          createdAt: { lt: before },
          OR: [{ id: { in: bare }, receiptKey: null }, { receiptKey: { in: removed } }],
        },
      })
    ).count;
  }

  const messages = await deps.prisma.message.deleteMany({ where: { createdAt: { lt: before } } });
  const conversations = await deps.prisma.conversation.deleteMany({
    where: { createdAt: { lt: before }, messages: { none: {} }, lead: null },
  });

  return { leads: leads.count, messages: messages.count, conversations: conversations.count, orders, receipts };
}

export function createHousekeepingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  removeObjects: RemoveObjects | null;
  log?: { info: (details: object, message: string) => void; warn: (details: object, message: string) => void };
}): Worker {
  return new Worker(
    HOUSEKEEPING_QUEUE,
    async (job) => {
      if (job.name === RETENTION_JOB) {
        const deleted = await runRetention({ prisma: deps.prisma, now: new Date(), removeObjects: deps.removeObjects, log: deps.log });
        deps.log?.info(deleted, 'retention sweep done');
      }
    },
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.housekeeping },
  );
}

/** 03:00 in Malaysia, when the fewest visitors are mid-conversation. Upserted under a fixed id. */
export async function scheduleHousekeepingJobs(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(RETENTION_JOB, { pattern: '0 3 * * *', tz: 'Asia/Kuala_Lumpur' }, { name: RETENTION_JOB });
}

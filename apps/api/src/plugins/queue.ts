import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  GROUP_QUEUE,
  INGEST_QUEUE,
  LEAD_QUEUE,
  MAIL_QUEUE,
  type GroupJobData,
  type IngestJobData,
  type LeadJobData,
  type MailJobData,
} from '@curios/core';

declare module 'fastify' {
  interface FastifyInstance {
    ingestQueue: Queue<IngestJobData>;
    mailQueue: Queue<MailJobData>;
    leadQueue: Queue<LeadJobData>;
    groupQueue: Queue<GroupJobData>;
  }
}

/** How long a close waits for the queues to finish starting up. */
const QUEUE_READY_ON_CLOSE_MS = 1000;

export const queuePlugin = fp(async (app: FastifyInstance) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const queue = new Queue<IngestJobData>(INGEST_QUEUE, { connection });
  const mailQueue = new Queue<MailJobData>(MAIL_QUEUE, { connection });
  const leadQueue = new Queue<LeadJobData>(LEAD_QUEUE, { connection });
  const groupQueue = new Queue<GroupJobData>(GROUP_QUEUE, { connection });

  app.decorate('ingestQueue', queue);
  app.decorate('mailQueue', mailQueue);
  app.decorate('leadQueue', leadQueue);
  app.decorate('groupQueue', groupQueue);
  app.addHook('onClose', async () => {
    // Each queue runs its own startup commands in the background, and nothing
    // awaits them. Closed before they finish, a queue goes on issuing them on
    // a connection that is gone, and each one surfaces as an unhandled
    // rejection -- one per queue, on an app closed within milliseconds of
    // booting. Bounded, because with maxRetriesPerRequest: null readiness
    // never arrives during a Redis outage, and a shutdown must not hang on it.
    await Promise.race([
      Promise.allSettled([queue, mailQueue, leadQueue, groupQueue].map((q) => q.waitUntilReady())),
      sleep(QUEUE_READY_ON_CLOSE_MS, undefined, { ref: false }),
    ]);
    await queue.close();
    await mailQueue.close();
    await leadQueue.close();
    await groupQueue.close();
    connection.disconnect();
  });
});

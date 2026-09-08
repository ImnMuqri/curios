import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  INGEST_QUEUE,
  LEAD_QUEUE,
  MAIL_QUEUE,
  type IngestJobData,
  type LeadJobData,
  type MailJobData,
} from '@curios/core';

declare module 'fastify' {
  interface FastifyInstance {
    ingestQueue: Queue<IngestJobData>;
    mailQueue: Queue<MailJobData>;
    leadQueue: Queue<LeadJobData>;
  }
}

export const queuePlugin = fp(async (app: FastifyInstance) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const queue = new Queue<IngestJobData>(INGEST_QUEUE, { connection });
  const mailQueue = new Queue<MailJobData>(MAIL_QUEUE, { connection });
  const leadQueue = new Queue<LeadJobData>(LEAD_QUEUE, { connection });

  app.decorate('ingestQueue', queue);
  app.decorate('mailQueue', mailQueue);
  app.decorate('leadQueue', leadQueue);
  app.addHook('onClose', async () => {
    await queue.close();
    await mailQueue.close();
    await leadQueue.close();
    connection.disconnect();
  });
});

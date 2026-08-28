import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { INGEST_QUEUE, type IngestJobData } from '@curios/core';

declare module 'fastify' {
  interface FastifyInstance {
    ingestQueue: Queue<IngestJobData>;
  }
}

export const queuePlugin = fp(async (app: FastifyInstance) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const queue = new Queue<IngestJobData>(INGEST_QUEUE, { connection });

  app.decorate('ingestQueue', queue);
  app.addHook('onClose', async () => {
    await queue.close();
    connection.disconnect();
  });
});

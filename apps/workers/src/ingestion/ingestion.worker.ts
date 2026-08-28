import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@curios/db';
import type { Gateway } from '@curios/gateway';
import { INGEST_QUEUE, type IngestJobData } from '@curios/core';
import { createWebsiteAdapter } from '../sources/website.adapter.js';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runExtraction } from './extract.service.js';

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'CuriosBot/0.1 (+https://curios.my/bot)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

export function createIngestionWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  gateway: Gateway;
}): Worker<IngestJobData> {
  const adapter = createWebsiteAdapter({ fetchPage });

  return new Worker<IngestJobData>(
    INGEST_QUEUE,
    async (job) => runExtraction({ prisma: deps.prisma, gateway: deps.gateway, adapter }, job.data),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.ingest },
  );
}

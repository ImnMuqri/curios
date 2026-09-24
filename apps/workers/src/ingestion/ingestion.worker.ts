import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@curios/db';
import type { Gateway } from '@curios/gateway';
import type { Embedder } from '@curios/embeddings';
import { allowsPrivateAddresses, INGEST_QUEUE, type IngestJobData } from '@curios/core';
import { createWebsiteAdapter } from '../sources/website.adapter.js';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runExtraction } from './extract.service.js';
import { createGuardedAgent, fetchGuarded } from './safe-fetch.js';

export function createIngestionWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  gateway: Gateway;
  embedder: Embedder | null;
  log?: { warn: (details: object, message: string) => void };
}): Worker<IngestJobData> {
  // Read once, at construction. A flag consulted per request is a flag that can
  // change under a running crawl.
  const allowPrivate = allowsPrivateAddresses(process.env.INGEST_ALLOW_PRIVATE_ADDRESSES);

  // One Agent for the process, so connections pool across pages and across jobs.
  // One owner pasting a wrong URL and someone walking a range look identical
  // one at a time. Only the log can tell them apart.
  const onBlocked = (hostname: string, blocked: string) => {
    deps.log?.warn({ hostname, blocked }, 'ingest fetch refused a non-public address');
  };

  const agent = createGuardedAgent({ allowPrivate, onBlocked });

  const adapter = createWebsiteAdapter({
    fetchPage: (url) => fetchGuarded(url, { agent, allowPrivate, onBlocked }),
  });

  return new Worker<IngestJobData>(
    INGEST_QUEUE,
    async (job) =>
      runExtraction(
        { prisma: deps.prisma, gateway: deps.gateway, adapter, embedder: deps.embedder, log: deps.log },
        job.data,
      ),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.ingest },
  );
}

import { INGEST_QUEUE, type IngestJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';

export interface QueueLike {
  add(name: string, data: IngestJobData, opts?: unknown): Promise<{ id?: string }>;
}

export interface IngestDeps {
  prisma: PrismaClient;
  queue: QueueLike;
}

export class InvalidSourceUrlError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_SOURCE_URL';
  constructor() {
    super('That address is not a website. Paste an http or https link.');
  }
}

/** 202 and enqueue. Nothing generative runs inside an HTTP request. */
export async function startIngestion(
  deps: IngestDeps,
  input: { pageId: string; sourceUrl: string },
): Promise<{ ingestionId: string }> {
  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw new InvalidSourceUrlError();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InvalidSourceUrlError();

  const ingestion = await deps.prisma.ingestion.create({
    data: { pageId: input.pageId, sourceUrl: url.href },
    select: { id: true },
  });

  await deps.queue.add(
    INGEST_QUEUE,
    {
      ingestionId: ingestion.id,
      pageId: input.pageId,
      sourceUrl: url.href,
      // The ingestion id is stable per request, so a replayed job is a repeat of
      // the same work rather than new work.
      idempotencyKey: ingestion.id,
    },
    { jobId: ingestion.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  );

  return { ingestionId: ingestion.id };
}

export async function getIngestion(prisma: PrismaClient, id: string) {
  return prisma.ingestion.findUnique({
    where: { id },
    select: { id: true, status: true, extractedCount: true, error: true, sourceUrl: true },
  });
}

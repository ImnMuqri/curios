import { BlockedAddressError, INGEST_QUEUE, inspectSourceUrl, type IngestJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { HostGuard } from './host-guard.js';

export interface QueueLike {
  add(name: string, data: IngestJobData, opts?: unknown): Promise<{ id?: string }>;
}

export interface IngestDeps {
  prisma: PrismaClient;
  queue: QueueLike;
  /** Required on purpose: an optional guard with a live default is one a caller forgets. */
  guard: HostGuard;
}

export class InvalidSourceUrlError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_SOURCE_URL';
  constructor() {
    super('That address is not a website. Paste an http or https link.');
  }
}

export class BlockedSourceUrlError extends Error {
  readonly statusCode = 400;
  readonly code = 'BLOCKED_SOURCE_URL';
  constructor() {
    super('That address points somewhere this crawler will not go.');
    this.name = 'BlockedSourceUrlError';
  }
}

export class PageNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor() {
    // 404, not 403. A 403 confirms the id exists, which is itself a leak.
    super('No such page.');
    this.name = 'PageNotYoursError';
  }
}

/** 202 and enqueue. Nothing generative runs inside an HTTP request. */
export async function startIngestion(
  deps: IngestDeps,
  accountId: string,
  input: { pageId: string; sourceUrl: string },
): Promise<{ ingestionId: string }> {
  // Shape only. Whether the address is one we may reach -- literal or resolved
  // -- is the guard's question below, because that is where the escape hatch
  // is honoured.
  const verdict = inspectSourceUrl(input.sourceUrl);
  if (!verdict.ok) throw new InvalidSourceUrlError();
  const url = verdict.url;

  // Ownership is checked here, before any row exists. Facts land unverified,
  // so an ingestion into someone else's page plants claims in a stranger's
  // review queue waiting to be accepted.
  const page = await deps.prisma.page.findFirst({
    where: { id: input.pageId, accountId },
    select: { id: true },
  });
  if (!page) throw new PageNotYoursError();

  // After the ownership check, deliberately. Resolving first would let a
  // stranger use this endpoint as a resolver for pages they do not own, which
  // is a smaller leak than the one this function is here to close but a leak
  // opened by this function all the same.
  try {
    await deps.guard(verdict.hostname);
  } catch (error) {
    if (error instanceof BlockedAddressError) throw new BlockedSourceUrlError();
    throw error;
  }

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

export async function getIngestion(prisma: PrismaClient, accountId: string, id: string) {
  // Scoped in the query, not filtered after the read. A read-then-check
  // leaks through timing and through anything that logs the row, and it is one
  // careless early return away from returning another owner's sourceUrl.
  return prisma.ingestion.findFirst({
    where: { id, page: { accountId } },
    select: { id: true, status: true, extractedCount: true, error: true, sourceUrl: true },
  });
}

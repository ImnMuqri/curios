import type { PrismaClient } from '@curios/db';
import { INGEST_QUEUE } from '@curios/core';
import type { QueueLike } from '../ingest/ingest.service.js';

export class SourceNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404 rather than 403 for someone else's source: a 403 confirms the id exists.
    super('No such source.');
    this.name = 'SourceNotFoundError';
  }
}

export class SourceBusyError extends Error {
  readonly statusCode = 409;
  readonly code = 'SOURCE_BUSY';
  constructor() {
    super('This source is still being read. Try again when it finishes.');
    this.name = 'SourceBusyError';
  }
}

export class NotRecheckableError extends Error {
  readonly statusCode = 400;
  readonly code = 'SOURCE_NOT_RECHECKABLE';
  constructor() {
    super('Pasted text has nothing to read again. Add it as a new source instead.');
    this.name = 'NotRecheckableError';
  }
}

const SETTLED = ['SUCCEEDED', 'FAILED'] as const;

/**
 * Removes a source and every fact it wrote that the owner has not rejected --
 * accepted or still in Review. Rejected facts stay: the relation's SetNull
 * unlinks them, and their normalizedClaim keeps blocking a re-read.
 *
 * Refused while the source is queued or running, because the worker would
 * otherwise write facts pointing at a row that is gone. The final delete is
 * conditional on the status too, so a re-check claimed between this
 * function's read and its delete rolls the whole removal back rather than
 * racing it.
 *
 * A fact is credited to the one source that wrote it first, so a fact another
 * source also states goes too. The owner chose that; the screen says so.
 */
export async function removeSource(
  prisma: PrismaClient,
  accountId: string,
  sourceId: string,
): Promise<{ removedFacts: number }> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.ingestion.findFirst({
      where: { id: sourceId, page: { accountId } },
      select: { id: true, status: true },
    });
    if (!source) throw new SourceNotFoundError();
    if (source.status === 'QUEUED' || source.status === 'RUNNING') throw new SourceBusyError();

    const removed = await tx.fact.deleteMany({
      where: { ingestionId: source.id, rejectedAt: null, page: { accountId } },
    });
    const gone = await tx.ingestion.deleteMany({
      where: { id: source.id, page: { accountId }, status: { in: [...SETTLED] } },
    });
    if (gone.count !== 1) throw new SourceBusyError();

    return { removedFacts: removed.count };
  });
}

/**
 * Check for new facts: the same ingestion, read again. New facts are credited
 * to it and go to Review; wording that already exists -- tombstones included
 * -- is skipped by the worker's skipDuplicates. It never removes a fact.
 *
 * The claim is one conditional update, so two clicks cannot both queue a run.
 * The job id is fresh because BullMQ keeps completed jobs and silently drops
 * an add whose id it already holds.
 *
 * No host guard here: the address passed it when the source was added, and
 * the worker's own fetch is guarded at connect time either way.
 */
export async function recheckSource(
  deps: { prisma: PrismaClient; queue: QueueLike },
  accountId: string,
  sourceId: string,
): Promise<{ ingestionId: string }> {
  const source = await deps.prisma.ingestion.findFirst({
    where: { id: sourceId, page: { accountId } },
    select: { id: true, pageId: true, sourceUrl: true },
  });
  if (!source) throw new SourceNotFoundError();
  if (source.sourceUrl === null) throw new NotRecheckableError();

  const claimed = await deps.prisma.ingestion.updateMany({
    where: { id: source.id, page: { accountId }, status: { in: [...SETTLED] } },
    data: { status: 'QUEUED', error: null, extractedCount: 0, tracked: true },
  });
  if (claimed.count !== 1) throw new SourceBusyError();

  const jobId = `${source.id}-recheck-${Date.now()}`;
  try {
    await deps.queue.add(
      INGEST_QUEUE,
      { ingestionId: source.id, pageId: source.pageId, sourceUrl: source.sourceUrl, idempotencyKey: jobId },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  } catch (error) {
    // Left QUEUED, the row would read "Reading…" forever and refuse removal.
    await deps.prisma.ingestion.update({
      where: { id: source.id },
      data: { status: 'FAILED', error: 'We could not start reading it. Try again.' },
    });
    throw error;
  }
  return { ingestionId: source.id };
}

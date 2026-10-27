import { ADMIN_ACTIONS, isWalledSource, RETRY_WINDOW_MS } from '@curios/core';
import type { Settings } from '@curios/core/settings';
import type { PrismaClient } from '@curios/db';
import type { QueueLike } from '../ingest/ingest.service.js';
import { claimForReading, enqueueReading, SourceNotFoundError } from '../sources/source.service.js';
import { audit, type AdminActor } from './admin-pages.service.js';
import { writeAudit } from './audit.js';

export interface AdminSourcesDeps {
  prisma: PrismaClient;
  queue: QueueLike;
  settings: Settings;
  /** `request.log` fits it. Told about each source the queue would not take. */
  log?: { warn: (obj: object, msg: string) => void };
}

/** How far back "retry all failed" looks, by when the row last changed. */

export class SourceStateError extends Error {
  readonly statusCode = 409;
  readonly code = 'SOURCE_STATE';

  constructor(message: string) {
    super(message);
    this.name = 'SourceStateError';
  }
}

export class ReadingOffError extends Error {
  readonly statusCode = 409;
  readonly code = 'READING_OFF';

  constructor() {
    super('Reading is off. Turn it on in Controls first.');
    this.name = 'ReadingOffError';
  }
}

function requireReadingOn(settings: Settings) {
  if (!settings.switches.reading) throw new ReadingOffError();
}

/**
 * Reads one failed source again. The claim and the audit row share a
 * transaction; the job is queued after it commits, as an owner's re-read is.
 * Pasted and file sources are accepted: the worker reads their text from the row.
 */
export async function retrySource(deps: AdminSourcesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  requireReadingOn(deps.settings);

  const source = await deps.prisma.$transaction(async (tx) => {
    const found = await tx.ingestion.findUnique({
      where: { id },
      select: { id: true, pageId: true, sourceUrl: true, status: true, page: { select: { id: true, handle: true } } },
    });
    if (!found) throw new SourceNotFoundError();
    if (found.status !== 'FAILED') throw new SourceStateError('Only a failed source can be retried.');
    if (isWalledSource(found.sourceUrl)) throw new SourceStateError('That source cannot be read, so a retry would fail the same way.');

    // Conditional, so two admins retrying together queue one run.
    if (!(await claimForReading(tx, { id, status: 'FAILED' }))) throw new SourceStateError('Only a failed source can be retried.');
    await audit(tx, actor, found.page, ADMIN_ACTIONS.RETRIED_SOURCE, reason);
    return found;
  });

  await enqueueReading(deps, source);
}

/**
 * Every FAILED source updated in the last 7 days, one at a time: a walled one
 * is skipped, and so is one the queue would not take (it is marked FAILED
 * again) -- neither stops the rest. One audit row records the counts.
 */
export async function retryFailedSources(
  deps: AdminSourcesDeps,
  actor: AdminActor,
  reason: string,
): Promise<{ queued: number; skipped: number }> {
  requireReadingOn(deps.settings);

  const candidates = await deps.prisma.ingestion.findMany({
    where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - RETRY_WINDOW_MS) } },
    select: { id: true, pageId: true, sourceUrl: true },
    orderBy: { updatedAt: 'asc' },
  });

  let queued = 0;
  let skipped = 0;
  for (const source of candidates) {
    if (isWalledSource(source.sourceUrl) || !(await claimForReading(deps.prisma, { id: source.id, status: 'FAILED' }))) {
      skipped += 1;
      continue;
    }
    try {
      await enqueueReading(deps, source);
      queued += 1;
    } catch (err) {
      // Counted as skipped and the rest carry on, but not silently: the queue refusing is an outage.
      deps.log?.warn({ ingestionId: source.id, err: err instanceof Error ? err.name : typeof err }, 'retry all failed: the queue would not take a source');
      skipped += 1;
    }
  }

  await deps.prisma.$transaction((tx) =>
    writeAudit(tx, {
      adminUserId: actor.adminId,
      action: ADMIN_ACTIONS.RETRIED_FAILED_SOURCES,
      targetType: 'Source',
      // A placeholder, not a row id: the row is about every failed source at once, and its
      // metadata says how many were queued and skipped.
      targetId: 'all-failed',
      targetLabel: 'everyone',
      reason,
      metadata: { queued, skipped },
      ip: actor.ip,
    }),
  );
  return { queued, skipped };
}

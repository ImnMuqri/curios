import { BlockedAddressError, INGEST_QUEUE, inspectSourceUrl, type IngestJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { HostGuard } from './host-guard.js';
import { readSourceFile, UnreadableFileError } from './file-text.js';

/**
 * The shape `enqueue` below actually passes, and the one a re-check
 * (`source.service.ts`) needs to read back off its own mock in a test --
 * `unknown` let a caller pass anything but gave nothing to read. BullMQ's own
 * `JobsOptions` has far more fields; this is deliberately only the ones this
 * codebase uses; bivariant method assignability is why a real `Queue` still
 * satisfies this interface.
 */
export interface QueueJobOptions {
  jobId?: string;
  attempts?: number;
  backoff?: { type: string; delay: number };
}

export interface QueueLike {
  add(name: string, data: IngestJobData, opts?: QueueJobOptions): Promise<{ id?: string }>;
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
  input: { pageId: string; sourceUrl?: string; pastedText?: string },
): Promise<{ ingestionId: string }> {
  if (input.pastedText !== undefined) {
    return startFromPastedText(deps, accountId, input.pageId, input.pastedText);
  }
  // The route refuses a body with neither. This guards a direct caller.
  if (input.sourceUrl === undefined) throw new InvalidSourceUrlError();

  // Shape only. Whether the address is one we may reach -- literal or resolved
  // -- is the guard's question below, because that is where the escape hatch
  // is honoured.
  const verdict = inspectSourceUrl(input.sourceUrl);
  if (!verdict.ok) throw new InvalidSourceUrlError();
  const url = verdict.url;

  // Ownership is checked here, before any row exists. Facts land unverified,
  // so an ingestion into someone else's page plants claims in a stranger's
  // review queue waiting to be accepted.
  await assertOwnsPage(deps.prisma, accountId, input.pageId);

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

  await enqueue(deps.queue, { ingestionId: ingestion.id, pageId: input.pageId, sourceUrl: url.href });
  return { ingestionId: ingestion.id };
}

/**
 * The same path, for text the owner pasted. Ownership first, for the reason the
 * URL path gives. No host guard, because there is no host: a guard consulted
 * anyway would make the paste box fail whenever DNS does.
 */
async function startFromPastedText(
  deps: IngestDeps,
  accountId: string,
  pageId: string,
  pastedText: string,
): Promise<{ ingestionId: string }> {
  await assertOwnsPage(deps.prisma, accountId, pageId);

  const ingestion = await deps.prisma.ingestion.create({
    data: { pageId, pastedText },
    select: { id: true },
  });

  // No sourceUrl on the job: the worker reads the text from the row, so it
  // lives in one place and the job stays small.
  await enqueue(deps.queue, { ingestionId: ingestion.id, pageId });
  return { ingestionId: ingestion.id };
}

/** The name shown in the Sources list: the last path segment, trimmed, never empty. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/\s+/g, ' ').trim() ?? '';
  const chars = [...base];
  if (chars.length === 0) return 'Uploaded file';
  return chars.length <= 200 ? base : chars.slice(0, 200).join('');
}

/**
 * A file as a source: its text is read here, in the request -- it is parsing,
 * not generation, and the owner should hear "that is a scan" now, not from a
 * failed job later -- then it is stored and enqueued exactly like pasted text.
 * Ownership is checked before the file is opened.
 */
export async function startFromFile(
  deps: IngestDeps,
  accountId: string,
  input: { pageId: string; fileName: string; data: string },
): Promise<{ ingestionId: string; truncated: boolean }> {
  await assertOwnsPage(deps.prisma, accountId, input.pageId);

  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.byteLength === 0) throw new UnreadableFileError('That file is empty.');
  const { text, truncated } = await readSourceFile(new Uint8Array(bytes));

  const ingestion = await deps.prisma.ingestion.create({
    data: { pageId: input.pageId, pastedText: text, fileName: cleanFileName(input.fileName) },
    select: { id: true },
  });
  await enqueue(deps.queue, { ingestionId: ingestion.id, pageId: input.pageId });
  return { ingestionId: ingestion.id, truncated };
}

async function assertOwnsPage(prisma: PrismaClient, accountId: string, pageId: string): Promise<void> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, accountId },
    select: { id: true },
  });
  if (!page) throw new PageNotYoursError();
}

async function enqueue(
  queue: QueueLike,
  job: { ingestionId: string; pageId: string; sourceUrl?: string },
): Promise<void> {
  await queue.add(
    INGEST_QUEUE,
    // The ingestion id is stable per request, so a replayed job is a repeat of
    // the same work rather than new work.
    { ...job, idempotencyKey: job.ingestionId },
    { jobId: job.ingestionId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  );
}

export async function getIngestion(prisma: PrismaClient, accountId: string, id: string) {
  // Scoped in the query, not filtered after the read. A read-then-check
  // leaks through timing and through anything that logs the row, and it is one
  // careless early return away from returning another owner's sourceUrl.
  return prisma.ingestion.findFirst({
    where: { id, page: { accountId } },
    select: { id: true, status: true, extractedCount: true, progress: true, error: true, sourceUrl: true },
  });
}

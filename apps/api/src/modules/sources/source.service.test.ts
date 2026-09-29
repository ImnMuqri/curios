import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { INGEST_QUEUE } from '@curios/core';
import type { QueueLike } from '../ingest/ingest.service.js';
import { NotRecheckableError, recheckSource, removeSource, SourceBusyError, SourceNotFoundError } from './source.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await prisma.$disconnect();
});

let n = 0;
async function anOwner() {
  n += 1;
  const account = await prisma.account.create({
    data: {
      email: `src${n}@example.com`,
      pages: { create: { handle: `src${n}`, skeleton: `src${n}`, displayName: 'S' } },
    },
    include: { pages: true },
  });
  return { accountId: account.id, pageId: account.pages[0]!.id };
}

async function aSource(pageId: string, data: { status?: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; pasted?: boolean } = {}) {
  return prisma.ingestion.create({
    data: {
      pageId,
      status: data.status ?? 'SUCCEEDED',
      ...(data.pasted ? { pastedText: 'About us.' } : { sourceUrl: 'https://s.example/' }),
    },
  });
}

async function aFact(pageId: string, claim: string, extra: Record<string, unknown> = {}) {
  return prisma.fact.create({
    data: { pageId, category: 'MISC', claim, normalizedClaim: claim.toLowerCase(), confidence: 0.9, ...extra },
  });
}

describe('removeSource', () => {
  it('deletes its accepted and pending facts, and the source', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId);
    await aFact(pageId, 'accepted', { ingestionId: source.id, verified: true });
    await aFact(pageId, 'pending', { ingestionId: source.id });

    await expect(removeSource(prisma, accountId, source.id)).resolves.toEqual({ removedFacts: 2 });

    expect(await prisma.fact.count({ where: { pageId } })).toBe(0);
    expect(await prisma.ingestion.count({ where: { pageId } })).toBe(0);
  });

  it('keeps its rejected facts, unlinked, so they still block', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId);
    const rejected = await aFact(pageId, 'rejected', { ingestionId: source.id, rejectedAt: new Date() });

    await removeSource(prisma, accountId, source.id);

    const row = await prisma.fact.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(row.ingestionId).toBeNull();
    expect(row.rejectedAt).not.toBeNull();
  });

  it('deletes the removed facts’ vectors with them', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId);
    const fact = await aFact(pageId, 'embedded', { ingestionId: source.id, verified: true });
    await prisma.factEmbedding.create({
      data: { factId: fact.id, vector: Buffer.alloc(4), model: 'm', dims: 1 },
    });

    await removeSource(prisma, accountId, source.id);

    expect(await prisma.factEmbedding.count({ where: { factId: fact.id } })).toBe(0);
  });

  it('leaves another source’s, the owner’s and pre-tracking facts alone', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId);
    const other = await aSource(pageId);
    await aFact(pageId, 'other source', { ingestionId: other.id, verified: true });
    await aFact(pageId, 'owner', { origin: 'OWNER', verified: true });
    await aFact(pageId, 'untracked', { origin: 'UNTRACKED', verified: true });

    await expect(removeSource(prisma, accountId, source.id)).resolves.toEqual({ removedFacts: 0 });

    expect((await prisma.fact.findMany({ where: { pageId } })).map((f) => f.claim).sort()).toEqual(
      ['other source', 'owner', 'untracked'],
    );
  });

  // Review Focus 2.
  it.each(['QUEUED', 'RUNNING'] as const)('refuses a source that is %s, and deletes nothing', async (status) => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId, { status });
    await aFact(pageId, 'kept', { ingestionId: source.id, verified: true });

    await expect(removeSource(prisma, accountId, source.id)).rejects.toBeInstanceOf(SourceBusyError);

    expect(await prisma.fact.count({ where: { pageId } })).toBe(1);
    expect(await prisma.ingestion.count({ where: { pageId } })).toBe(1);
  });

  it('is a not-found for another owner’s source, and deletes nothing', async () => {
    const me = await anOwner();
    const them = await anOwner();
    const theirs = await aSource(them.pageId);
    await aFact(them.pageId, 'theirs', { ingestionId: theirs.id, verified: true });

    await expect(removeSource(prisma, me.accountId, theirs.id)).rejects.toBeInstanceOf(SourceNotFoundError);
    expect(await prisma.fact.count({ where: { pageId: them.pageId } })).toBe(1);
  });
});

describe('recheckSource', () => {
  const queue = () => ({ add: vi.fn<QueueLike['add']>(async () => ({ id: 'job' })) });

  it('queues the same source again, under a fresh job id', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await prisma.ingestion.create({
      data: { pageId, sourceUrl: 'https://s.example/', status: 'FAILED', error: 'boom', extractedCount: 3, tracked: false },
    });
    const q = queue();

    await expect(recheckSource({ prisma, queue: q }, accountId, source.id)).resolves.toEqual({ ingestionId: source.id });

    const row = await prisma.ingestion.findUniqueOrThrow({ where: { id: source.id } });
    expect(row).toMatchObject({ status: 'QUEUED', error: null, extractedCount: 0, tracked: true });
    const [name, data, options] = q.add.mock.calls[0]!;
    expect(name).toBe(INGEST_QUEUE);
    expect(data).toMatchObject({ ingestionId: source.id, pageId, sourceUrl: 'https://s.example/' });
    // BullMQ ignores an add whose jobId already exists, and the first run's
    // job is still in the completed set -- so the id must not be the
    // ingestion id, and must not contain ':' (BullMQ refuses it).
    expect(options?.jobId).not.toBe(source.id);
    expect(options?.jobId).toMatch(new RegExp(`^${source.id}-recheck-\\d+$`));
  });

  it.each(['QUEUED', 'RUNNING'] as const)('refuses a source that is %s, and queues nothing', async (status) => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId, { status });
    const q = queue();

    await expect(recheckSource({ prisma, queue: q }, accountId, source.id)).rejects.toBeInstanceOf(SourceBusyError);
    expect(q.add).not.toHaveBeenCalled();
  });

  it('refuses pasted text -- there is nothing to read again', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId, { pasted: true });
    const q = queue();

    await expect(recheckSource({ prisma, queue: q }, accountId, source.id)).rejects.toBeInstanceOf(NotRecheckableError);
    expect(q.add).not.toHaveBeenCalled();
  });

  it('marks the source FAILED if the queue will not take the job, so it is not stuck', async () => {
    const { accountId, pageId } = await anOwner();
    const source = await aSource(pageId);
    const q = { add: vi.fn<QueueLike['add']>(async () => { throw new Error('redis down'); }) };

    await expect(recheckSource({ prisma, queue: q }, accountId, source.id)).rejects.toThrow('redis down');
    expect((await prisma.ingestion.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('FAILED');
  });

  it('is a not-found for another owner’s source', async () => {
    const me = await anOwner();
    const them = await anOwner();
    const theirs = await aSource(them.pageId);
    const q = queue();

    await expect(recheckSource({ prisma, queue: q }, me.accountId, theirs.id)).rejects.toBeInstanceOf(SourceNotFoundError);
    expect(q.add).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getIngestion, startIngestion, type QueueLike } from './ingest.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: { create: { handle: 'nadia', displayName: 'Nadia Bakes' } },
    },
    include: { pages: true },
  });
  pageId = account.pages[0]!.id;
});

describe('startIngestion', () => {
  it('creates a queued ingestion row and enqueues a job', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const { ingestionId } = await startIngestion(
      { prisma, queue: { add } },
      { pageId, sourceUrl: 'https://nadia.example/' },
    );

    const row = await prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } });
    expect(row.status).toBe('QUEUED');
    expect(add).toHaveBeenCalledOnce();
  });

  it('passes an idempotency key so a replayed job does not duplicate work', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const { ingestionId } = await startIngestion(
      { prisma, queue: { add } },
      { pageId, sourceUrl: 'https://nadia.example/' },
    );
    expect(add.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: ingestionId });
  });

  it('rejects a non-http source url before touching the queue', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion({ prisma, queue: { add } }, { pageId, sourceUrl: 'file:///etc/passwd' }),
    ).rejects.toThrow(/http/i);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('getIngestion', () => {
  it('returns status and counts for polling', async () => {
    const row = await prisma.ingestion.create({
      data: { pageId, sourceUrl: 'https://nadia.example/', status: 'SUCCEEDED', extractedCount: 7 },
    });
    const result = await getIngestion(prisma, row.id);
    expect(result).toMatchObject({ status: 'SUCCEEDED', extractedCount: 7 });
  });

  it('returns null for an unknown id', async () => {
    expect(await getIngestion(prisma, 'nope')).toBeNull();
  });
});

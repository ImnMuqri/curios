import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BlockedAddressError } from '@curios/core';
import { getIngestion, startIngestion, type QueueLike } from './ingest.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let accountId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: { create: { handle: 'nadia', skeleton: 'nadia', displayName: 'Nadia Bakes' } },
    },
    include: { pages: true },
  });
  pageId = account.pages[0]!.id;
  accountId = account.id;
});

describe('startIngestion', () => {
  it('creates a queued ingestion row and enqueues a job', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const { ingestionId } = await startIngestion(
      { prisma, queue: { add }, guard: async () => {} },
      accountId,
      { pageId, sourceUrl: 'https://nadia.example/' },
    );

    const row = await prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } });
    expect(row.status).toBe('QUEUED');
    expect(add).toHaveBeenCalledOnce();
  });

  it('passes an idempotency key so a replayed job does not duplicate work', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const { ingestionId } = await startIngestion(
      { prisma, queue: { add }, guard: async () => {} },
      accountId,
      { pageId, sourceUrl: 'https://nadia.example/' },
    );
    expect(add.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: ingestionId });
  });

  it('rejects a non-http source url before touching the queue', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion(
        { prisma, queue: { add }, guard: async () => {} },
        accountId,
        { pageId, sourceUrl: 'file:///etc/passwd' },
      ),
    ).rejects.toThrow(/http/i);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a url whose host resolves privately, and leaves no row behind', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion(
        {
          prisma,
          queue: { add },
          guard: async () => {
            throw new BlockedAddressError('10.0.0.5');
          },
        },
        accountId,
        { pageId, sourceUrl: 'https://internal.example/' },
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE_URL', statusCode: 400 });

    // The absence of the row is the assertion that matters. A refused URL that
    // still writes one turns the table into a log of attempts.
    expect(await prisma.ingestion.count()).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses an address literal before it resolves anything', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const guard = vi.fn(async () => {});
    await expect(
      startIngestion({ prisma, queue: { add }, guard }, accountId, {
        pageId,
        sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE_URL' });
    expect(guard).not.toHaveBeenCalled();
  });

  it('refuses embedded credentials', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion({ prisma, queue: { add }, guard: async () => {} }, accountId, {
        pageId,
        sourceUrl: 'http://user:pw@nadia.example/',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_URL' });
  });
});

describe('getIngestion', () => {
  it('returns status and counts for polling', async () => {
    const row = await prisma.ingestion.create({
      data: { pageId, sourceUrl: 'https://nadia.example/', status: 'SUCCEEDED', extractedCount: 7 },
    });
    const result = await getIngestion(prisma, accountId, row.id);
    expect(result).toMatchObject({ status: 'SUCCEEDED', extractedCount: 7 });
  });

  it('returns null for an unknown id', async () => {
    expect(await getIngestion(prisma, accountId, 'nope')).toBeNull();
  });
});

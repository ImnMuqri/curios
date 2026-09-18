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

  it('sends an address literal to the guard rather than judging it here', async () => {
    // A literal is not special-cased. It goes to the same guard as a hostname,
    // which is what lets INGEST_ALLOW_PRIVATE_ADDRESSES apply to it -- the
    // manual walkthrough crawls http://127.0.0.1:8099/, and a literal refused
    // before the flag is consulted makes that switch do nothing.
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const guard = vi.fn(async () => {});

    await startIngestion({ prisma, queue: { add }, guard }, accountId, {
      pageId,
      sourceUrl: 'http://127.0.0.1:8099/',
    });

    expect(guard).toHaveBeenCalledWith('127.0.0.1');
  });

  it('refuses a literal when the guard refuses it, and enqueues nothing', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion(
        {
          prisma,
          queue: { add },
          guard: async () => {
            throw new BlockedAddressError('169.254.169.254');
          },
        },
        accountId,
        { pageId, sourceUrl: 'http://169.254.169.254/latest/meta-data/' },
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE_URL' });
    expect(add).not.toHaveBeenCalled();
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

  it('starts an ingestion from pasted text, with no website address anywhere', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));

    const { ingestionId } = await startIngestion(
      { prisma, queue: { add }, guard: async () => {} },
      accountId,
      { pageId, pastedText: 'I bake cakes in Shah Alam.' },
    );

    const row = await prisma.ingestion.findUniqueOrThrow({
      where: { id: ingestionId },
      select: { status: true, sourceUrl: true, pastedText: true },
    });
    expect(row).toEqual({ status: 'QUEUED', sourceUrl: null, pastedText: 'I bake cakes in Shah Alam.' });
    // No sourceUrl key at all: the worker reads the text from the row.
    expect(add.mock.calls[0]?.[1]).toEqual({ ingestionId, pageId, idempotencyKey: ingestionId });
  });

  it('never asks the host guard about pasted text', async () => {
    // There is no host to guard. A guard consulted anyway would make the paste
    // box fail whenever DNS does.
    const guard = vi.fn(async () => {});

    await startIngestion(
      { prisma, queue: { add: vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' })) }, guard },
      accountId,
      { pageId, pastedText: 'About me.' },
    );

    expect(guard).not.toHaveBeenCalled();
  });

  it('refuses pasted text for a page that is not yours, and writes nothing', async () => {
    await expect(
      startIngestion(
        { prisma, queue: { add: vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' })) }, guard: async () => {} },
        'someone-else',
        { pageId, pastedText: 'Not my page.' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.ingestion.count({ where: { pageId } })).toBe(0);
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

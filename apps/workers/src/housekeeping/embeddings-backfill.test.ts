import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Embedder } from '@curios/embeddings';
import { EMBEDDINGS_BACKFILL_JOB, runEmbeddingsBackfill } from './embeddings-backfill.js';
import { scheduleHousekeepingJobs } from './retention.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const embedder: Embedder = {
  model: 'backfill-test',
  dims: 3,
  embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0]))),
};

let accountId = '';
let pageId = '';

beforeAll(async () => {
  const account = await prisma.account.create({
    data: {
      email: `backfill-${randomUUID()}@example.com`,
      pages: { create: { handle: `b${randomUUID().slice(0, 8)}`, skeleton: `b${randomUUID().slice(0, 8)}`, displayName: 'Backfill' } },
    },
    include: { pages: true },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
});

afterAll(async () => {
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

const aFact = (claim: string, rejectedAt: Date | null = null) =>
  prisma.fact.create({ data: { pageId, category: 'MISC', claim, normalizedClaim: claim, question: `${claim}?`, confidence: 1, rejectedAt } });

describe('runEmbeddingsBackfill', () => {
  it('gives the facts short a vector one, skips rejected facts, and does nothing the second time', async () => {
    const missing = await aFact('Open 9 to 5');
    const rejected = await aFact('Closed Sundays', new Date());
    const where = { pageId };

    expect(await runEmbeddingsBackfill({ prisma, embedder, where })).toEqual({ scanned: 1, embedded: 1 });
    expect(await prisma.factEmbedding.count({ where: { factId: missing.id, model: 'backfill-test' } })).toBe(1);
    expect(await prisma.factEmbedding.count({ where: { factId: rejected.id } })).toBe(0);

    expect(await runEmbeddingsBackfill({ prisma, embedder, where })).toEqual({ scanned: 0, embedded: 0 });
  });

  it('is scheduled daily at 04:00 in Kuala Lumpur', async () => {
    const queue = { upsertJobScheduler: vi.fn(async () => ({})) };
    await scheduleHousekeepingJobs(queue);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EMBEDDINGS_BACKFILL_JOB,
      { pattern: '0 4 * * *', tz: 'Asia/Kuala_Lumpur' },
      { name: EMBEDDINGS_BACKFILL_JOB },
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  decodeVector,
  EMBED_BATCH,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  type Embedder,
} from '@curios/embeddings';
import { syncFactEmbeddings } from './fact-embedding.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

/** An embedder that returns a vector whose first value is the text's length. */
function embedderCounting(): { embedder: Embedder; calls: () => string[][] } {
  const calls: string[][] = [];
  return {
    calls: () => calls,
    embedder: {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async (texts) => {
        calls.push(texts);
        return texts.map((text) => {
          const vector = new Float32Array(EMBEDDING_DIMS);
          vector[0] = text.length;
          return vector;
        });
      },
    },
  };
}

async function seedPage(facts: { claim: string; question?: string | null; rejected?: boolean }[]) {
  const account = await prisma.account.create({
    data: {
      email: `e${Date.now()}${Math.random()}@example.com`,
      pages: {
        create: {
          handle: `h${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          skeleton: `s${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          displayName: 'A Page',
          facts: {
            create: facts.map((fact) => ({
              category: 'PRICE' as const,
              claim: fact.claim,
              question: fact.question ?? null,
              normalizedClaim: fact.claim.toLowerCase(),
              confidence: 1,
              rejectedAt: fact.rejected === true ? new Date() : null,
            })),
          },
        },
      },
    },
    include: { pages: true },
  });
  const page = account.pages[0];
  if (!page) throw new Error('seed produced no page');
  return page.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('syncFactEmbeddings', () => {
  it('writes one row per fact that has none', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }, { claim: 'Buka 9 pagi.' }]);
    const { embedder } = embedderCounting();

    const result = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(result).toEqual({ scanned: 2, embedded: 2 });
    expect(await prisma.factEmbedding.count()).toBe(2);
  });

  // The whole idea of the slice. A fact's question is what a visitor's
  // question is matched against; embedding the claim instead is the design
  // that failed twice before.
  it('embeds the question a fact answers, not its claim', async () => {
    const pageId = await seedPage([
      { claim: 'Kek butter 1kg RM95.', question: 'Berapa harga kek butter?' },
    ]);
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(calls()[0]).toEqual(['Berapa harga kek butter?']);
  });

  it('falls back to the claim when a fact has no question', async () => {
    const pageId = await seedPage([{ claim: 'Kek butter 1kg RM95.', question: null }]);
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(calls()[0]).toEqual(['Kek butter 1kg RM95.']);
  });

  it('stores the model and width on every row, so a later change is detectable', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    const row = await prisma.factEmbedding.findFirstOrThrow();
    expect(row.model).toBe(EMBEDDING_MODEL);
    expect(row.dims).toBe(EMBEDDING_DIMS);
    expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe('Kek RM95.'.length);
  });

  it('skips a fact that already has a current vector', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });

    const second = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(second).toEqual({ scanned: 0, embedded: 0 });
    expect(calls()).toHaveLength(1);
  });

  // Changing EMBEDDING_MODEL must be a backfill, not a migration: rows from
  // the old model are re-embedded rather than compared against vectors from
  // a different space.
  it('re-embeds a fact whose stored vector came from another model', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });
    await prisma.factEmbedding.updateMany({ data: { model: 'something-older' } });

    const result = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(result.embedded).toBe(1);
    expect(await prisma.factEmbedding.findFirstOrThrow()).toMatchObject({ model: EMBEDDING_MODEL });
  });

  it('re-embeds a fact whose stored vector is a different width', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });
    await prisma.factEmbedding.updateMany({ data: { dims: 64 } });

    expect((await syncFactEmbeddings(prisma, embedder, { pageId })).embedded).toBe(1);
  });

  // A rejected fact was dismissed by the owner and can never reach an answer.
  it('leaves rejected facts alone', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.', rejected: true }]);
    const { embedder } = embedderCounting();

    expect(await syncFactEmbeddings(prisma, embedder, { pageId })).toEqual({
      scanned: 0,
      embedded: 0,
    });
  });

  it('honours the caller’s filter and touches no other page', async () => {
    const mine = await seedPage([{ claim: 'Kek RM95.' }]);
    await seedPage([{ claim: 'Roti RM5.' }]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId: mine });

    expect(await prisma.factEmbedding.count()).toBe(1);
  });

  it('batches, so one large page is several requests rather than one', async () => {
    const pageId = await seedPage(
      Array.from({ length: 5 }, (_unused, index) => ({ claim: `Fakta ${index}.` })),
    );
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId }, { batch: 2 });

    expect(calls().map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(await prisma.factEmbedding.count()).toBe(5);
  });

  // The vector a fact gets must be its own. A batch written back by position
  // instead of by fact id is the bug that gives every fact on a page its
  // neighbour's vector, and no assertion anywhere else would catch it.
  it('gives each fact its own vector, across a batch boundary', async () => {
    const pageId = await seedPage([
      { claim: 'a' },
      { claim: 'bb' },
      { claim: 'ccc' },
      { claim: 'dddd' },
    ]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId }, { batch: 2 });

    const rows = await prisma.factEmbedding.findMany({ include: { fact: true } });
    for (const row of rows) {
      expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe(row.fact.claim.length);
    }
  });

  // Not in the brief. Every other test passes `{ batch: 2 }` or has too few
  // facts to distinguish one batch size from another, so `options.batch ??
  // EMBED_BATCH` could be replaced with `options.batch ?? 1` (or any other
  // number) and the suite above would stay green. This is the only test that
  // exercises the omitted-options path against the real constant.
  it('defaults to EMBED_BATCH when the caller gives no batch size', async () => {
    const account = await prisma.account.create({
      data: {
        email: `e${Date.now()}${Math.random()}@example.com`,
        pages: {
          create: {
            handle: `h${Date.now()}${Math.floor(Math.random() * 1e6)}`,
            skeleton: `s${Date.now()}${Math.floor(Math.random() * 1e6)}`,
            displayName: 'A Page',
          },
        },
      },
      include: { pages: true },
    });
    const pageId = account.pages[0]!.id;
    await prisma.fact.createMany({
      data: Array.from({ length: EMBED_BATCH + 1 }, (_unused, index) => ({
        pageId,
        category: 'PRICE' as const,
        claim: `Fakta ${index}.`,
        normalizedClaim: `fakta ${index}`,
        confidence: 1,
      })),
    });
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(calls().map((batch) => batch.length)).toEqual([EMBED_BATCH, 1]);
  });

  // Not in the brief. No other test re-embeds a row and then checks
  // `createdAt`, so `update: { ...row, createdAt: new Date() }` could drop
  // to `update: { ...row }` and every test above would stay green — the
  // model/dims/vector assertions all pass either way. A row's `createdAt` is
  // how staleness would be read by anything built on top of this table
  // later (a "vectors last computed" report, say), so a re-embed that
  // silently keeps the original timestamp would be a real, quiet bug.
  it('refreshes createdAt when a fact is re-embedded, not only its vector', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });
    const stale = new Date('2020-01-01T00:00:00.000Z');
    await prisma.factEmbedding.updateMany({ data: { model: 'something-older', createdAt: stale } });

    await syncFactEmbeddings(prisma, embedder, { pageId });

    const row = await prisma.factEmbedding.findFirstOrThrow();
    expect(row.createdAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('lets a failure from the provider reach the caller', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const embedder: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };

    await expect(syncFactEmbeddings(prisma, embedder, { pageId })).rejects.toThrow(
      /provider unavailable/,
    );
    expect(await prisma.factEmbedding.count()).toBe(0);
  });
});

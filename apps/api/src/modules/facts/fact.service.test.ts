import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { decodeVector, EMBEDDING_DIMS, EMBEDDING_MODEL, type Embedder } from '@curios/embeddings';
import { syncFactEmbeddings } from '@curios/db';
import { editFact, FactNotFoundError } from './fact.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

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

async function seedFact(fact: { claim: string; question?: string | null }) {
  const account = await prisma.account.create({
    data: {
      email: `e${Date.now()}${Math.random()}@example.com`,
      pages: {
        create: {
          handle: `h${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          skeleton: `s${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          displayName: 'A Page',
          facts: {
            create: {
              category: 'PRICE' as const,
              claim: fact.claim,
              question: fact.question ?? null,
              normalizedClaim: fact.claim.toLowerCase(),
              confidence: 1,
            },
          },
        },
      },
    },
    include: { pages: { include: { facts: true } } },
  });
  const page = account.pages[0];
  const row = page?.facts[0];
  if (!page || !row) throw new Error('seed produced no fact');
  return { accountId: account.id, factId: row.id };
}

describe('editFact and the fact’s vector', () => {
  it('re-embeds a fact whose vector was of its claim', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    await editFact(prisma, accountId, factId, 'Kek RM120.', embedder);

    expect(calls().at(-1)).toEqual(['Kek RM120.']);
    const row = await prisma.factEmbedding.findUniqueOrThrow({ where: { factId } });
    expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe('Kek RM120.'.length);
  });

  // The vector is of the question, the question did not change, and a call to
  // write the same numbers back is a call nobody needed.
  it('leaves the vector alone when the fact carries a question', async () => {
    const { accountId, factId } = await seedFact({
      claim: 'Kek RM95.',
      question: 'Berapa harga kek?',
    });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });
    const before = calls().length;

    await editFact(prisma, accountId, factId, 'Kek RM120.', embedder);

    expect(calls()).toHaveLength(before);
    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(1);
  });

  // A stale vector matches the wording of a claim that no longer exists. No
  // vector means the page falls back and sends everything, which is right.
  it('deletes the vector when re-embedding fails, rather than leaving a stale one', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    const failing: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };
    await editFact(prisma, accountId, factId, 'Kek RM120.', failing);

    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(0);
    const fact = await prisma.fact.findUniqueOrThrow({ where: { id: factId } });
    expect(fact.claim).toBe('Kek RM120.');
  });

  // syncFactEmbeddings deliberately does not log a failure itself ("a caller
  // decides whether a failure to embed is fatal"), so this catch is the one
  // place an embedding outage during an owner's edit becomes visible to
  // anyone. Asserting only "warn was called" would stay green even if the
  // message were swapped for an unrelated string or `err` were dropped from
  // the payload -- that's exactly the gap Task 4 left in the worker's version
  // of this same call. The exact payload and message are asserted here, and
  // an exact-match assertion also catches the claim text ever being added to
  // it, which the global logging rule forbids.
  it('logs the failure when re-embedding fails, with an id and the error but never the claim', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    const failing: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };
    const log = { warn: vi.fn() };

    await editFact(prisma, accountId, factId, 'Kek RM120.', failing, log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { factId, err: 'provider unavailable' },
      'fact edited but its vector could not be refreshed; this page falls back until a backfill runs',
    );
  });

  it('deletes the vector when there is no embedder at all', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    await editFact(prisma, accountId, factId, 'Kek RM120.', null);

    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(0);
  });

  // syncFactEmbeddings scans for every pending fact matching its `where`, not
  // only the one named -- so a filter this loose (`{}`, say) would still pass
  // every other test in this file, which never has a second fact around to
  // notice. This is the one that would.
  it('re-embeds only the fact that was edited, not every other pending one', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const other = await seedFact({ claim: 'Roti RM5.', question: null });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    await editFact(prisma, accountId, factId, 'Kek RM120.', embedder);

    expect(calls().every((call) => call[0] !== 'Roti RM5.')).toBe(true);
    expect(await prisma.factEmbedding.count({ where: { factId: other.factId } })).toBe(0);
  });

  it('touches no vector when the edit itself was refused', async () => {
    const { factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });
    const before = calls().length;

    await expect(
      editFact(prisma, 'somebody-else', factId, 'Kek RM120.', embedder),
    ).rejects.toThrow(FactNotFoundError);

    expect(calls()).toHaveLength(before);
    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(1);
  });
});

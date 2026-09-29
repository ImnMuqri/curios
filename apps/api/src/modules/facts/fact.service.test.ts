import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { decodeVector, EMBEDDING_DIMS, EMBEDDING_MODEL, type Embedder } from '@curios/embeddings';
import { syncFactEmbeddings } from '@curios/db';
import { normalizeClaim } from '@curios/core';
import { addFact, DuplicateFactError, editFact, FactNotFoundError, InvalidFactError } from './fact.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
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

async function factsOn(accountId: string) {
  return prisma.fact.findMany({ where: { page: { accountId } }, orderBy: { createdAt: 'asc' } });
}

async function anIngestionFor(accountId: string) {
  const page = await prisma.page.findUniqueOrThrow({ where: { accountId } });
  return prisma.ingestion.create({ data: { pageId: page.id, sourceUrl: 'https://a.example/', status: 'SUCCEEDED' } });
}

describe('editFact makes the fact the owner’s', () => {
  it('marks it OWNER and unlinks it from its source', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    const source = await anIngestionFor(accountId);
    await prisma.fact.update({ where: { id: factId }, data: { ingestionId: source.id, origin: 'EXTRACTED' } });

    await editFact(prisma, accountId, factId, 'Open 9 to 6.', null);

    const fact = await prisma.fact.findUniqueOrThrow({ where: { id: factId } });
    expect(fact.origin).toBe('OWNER');
    expect(fact.ingestionId).toBeNull();
  });

  it('leaves verified exactly as it was -- an edit is not an accept', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    await editFact(prisma, accountId, factId, 'Open 9 to 6.', null);
    expect((await prisma.fact.findUniqueOrThrow({ where: { id: factId } })).verified).toBe(false);
  });

  it('tombstones the old wording so a re-read cannot bring it back', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    await prisma.fact.update({ where: { id: factId }, data: { normalizedClaim: normalizeClaim('Open 9 to 5.') } });

    await editFact(prisma, accountId, factId, 'Open 9 to 6.', null);

    const tombstone = (await factsOn(accountId)).find((f) => f.id !== factId);
    expect(tombstone).toMatchObject({
      claim: 'Open 9 to 5.',
      normalizedClaim: normalizeClaim('Open 9 to 5.'),
      verified: false,
      origin: 'OWNER',
    });
    expect(tombstone?.rejectedAt).not.toBeNull();
  });

  it('writes no tombstone when only the punctuation or case changed', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    await prisma.fact.update({ where: { id: factId }, data: { normalizedClaim: normalizeClaim('Open 9 to 5.') } });

    await editFact(prisma, accountId, factId, 'open 9 to 5', null);

    expect(await factsOn(accountId)).toHaveLength(1);
  });

  // Review Focus 1.
  it('can be edited back to what it said', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    await prisma.fact.update({ where: { id: factId }, data: { normalizedClaim: normalizeClaim('Open 9 to 5.') } });

    await editFact(prisma, accountId, factId, 'Open 9 to 6.', null);
    await editFact(prisma, accountId, factId, 'Open 9 to 5.', null);

    const facts = await factsOn(accountId);
    const live = facts.filter((f) => f.rejectedAt === null);
    expect(live.map((f) => f.claim)).toEqual(['Open 9 to 5.']);
    // The 9-to-5 tombstone was replaced by the live fact; the 9-to-6 one is new.
    expect(facts.filter((f) => f.rejectedAt !== null).map((f) => f.claim)).toEqual(['Open 9 to 6.']);
  });

  it('still refuses a clash with another live fact', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Open 9 to 5.' });
    const page = await prisma.page.findUniqueOrThrow({ where: { accountId } });
    await prisma.fact.create({
      data: { pageId: page.id, category: 'HOURS', claim: 'Closed Sunday.', normalizedClaim: normalizeClaim('Closed Sunday.'), confidence: 1 },
    });

    await expect(editFact(prisma, accountId, factId, 'Closed Sunday.', null)).rejects.toBeInstanceOf(DuplicateFactError);
    // Rolled back: no tombstone was left behind by the failed edit.
    expect(await factsOn(accountId)).toHaveLength(2);
  });

  it('is a not-found for another owner’s fact, and writes nothing', async () => {
    const mine = await seedFact({ claim: 'Mine.' });
    const theirs = await seedFact({ claim: 'Theirs.' });

    await expect(editFact(prisma, mine.accountId, theirs.factId, 'Hijacked.', null)).rejects.toBeInstanceOf(FactNotFoundError);
    expect(await factsOn(theirs.accountId)).toHaveLength(1);
  });
});

describe('addFact', () => {
  it('adds one live OWNER fact', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });

    const { id } = await addFact(prisma, accountId, { category: 'HOURS', claim: '  Closed on public holidays.  ' }, null);

    const fact = await prisma.fact.findUniqueOrThrow({ where: { id } });
    expect(fact).toMatchObject({
      claim: 'Closed on public holidays.',
      normalizedClaim: normalizeClaim('Closed on public holidays.'),
      category: 'HOURS',
      verified: true,
      origin: 'OWNER',
      ingestionId: null,
      confidence: 1,
    });
  });

  it('verifies nothing but the fact it creates', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Pending.' });
    await addFact(prisma, accountId, { category: 'MISC', claim: 'New.' }, null);
    expect((await prisma.fact.findUniqueOrThrow({ where: { id: factId } })).verified).toBe(false);
  });

  it('embeds the new fact', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });
    const { embedder, calls } = embedderCounting();

    const { id } = await addFact(prisma, accountId, { category: 'MISC', claim: 'Parking at the back.' }, embedder);

    expect(calls().at(-1)).toEqual(['Parking at the back.']);
    expect(await prisma.factEmbedding.findUnique({ where: { factId: id } })).not.toBeNull();
  });

  it('refuses an empty claim, an over-long one, and an unknown category', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: '   ' }, null)).rejects.toBeInstanceOf(InvalidFactError);
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: 'x'.repeat(501) }, null)).rejects.toBeInstanceOf(InvalidFactError);
    await expect(addFact(prisma, accountId, { category: 'WEATHER', claim: 'Sunny.' }, null)).rejects.toBeInstanceOf(InvalidFactError);
  });

  it('counts the limit in characters, not UTF-16 units', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: '🎂'.repeat(500) }, null)).resolves.toHaveProperty('id');
  });

  it('refuses a clash with a live fact', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });
    await prisma.fact.updateMany({ where: { page: { accountId } }, data: { normalizedClaim: normalizeClaim('Existing.') } });
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: 'Existing.' }, null)).rejects.toBeInstanceOf(DuplicateFactError);
  });

  it('replaces a rejected fact with the same words -- the owner is vouching for it now', async () => {
    const { accountId, factId } = await seedFact({ claim: 'We deliver.' });
    await prisma.fact.update({
      where: { id: factId },
      data: { normalizedClaim: normalizeClaim('We deliver.'), rejectedAt: new Date() },
    });

    const { id } = await addFact(prisma, accountId, { category: 'POLICY', claim: 'We deliver.' }, null);

    const facts = await factsOn(accountId);
    expect(facts.map((f) => f.id)).toEqual([id]);
  });

  it('refuses an owner with no page', async () => {
    const account = await prisma.account.create({ data: { email: `np${Date.now()}@example.com` } });
    await expect(addFact(prisma, account.id, { category: 'MISC', claim: 'x' }, null)).rejects.toMatchObject({ code: 'NO_PAGE' });
  });

  // Not in the brief's own test list -- the /[\r\n]/ check is a line the
  // given tests never exercise: every other bad-claim case (empty, over-long,
  // bad category) would still pass with it deleted, and the suite would stay
  // green. "One line" is also the promise InvalidFactError's own message
  // makes, so a claim smuggling a second line past the length check must be
  // refused too.
  it('refuses a claim with an embedded line break, even a short one', async () => {
    const { accountId } = await seedFact({ claim: 'Existing.' });
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: 'Line one\nLine two' }, null)).rejects.toBeInstanceOf(InvalidFactError);
    await expect(addFact(prisma, accountId, { category: 'MISC', claim: 'Line one\r\nLine two' }, null)).rejects.toBeInstanceOf(InvalidFactError);
  });

  // Also not in the brief's own test list. addFact checks the claim before
  // it looks up the page, so an account with both a bad claim and no page
  // gets INVALID_FACT, not NO_PAGE -- consistent with claimHandle elsewhere,
  // which checks the handle's shape before it checks anything about the
  // database. Swapping the two checks would still pass every other test here
  // (none combines "no page" with "bad claim"), so this pins the order.
  it('checks the claim before it checks for a page', async () => {
    const account = await prisma.account.create({ data: { email: `np2${Date.now()}@example.com` } });
    await expect(addFact(prisma, account.id, { category: 'WEATHER', claim: '   ' }, null)).rejects.toBeInstanceOf(InvalidFactError);
  });
});

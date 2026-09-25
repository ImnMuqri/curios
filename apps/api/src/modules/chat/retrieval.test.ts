import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RETRIEVAL_MIN_FACTS } from '@curios/core';
import {
  encodeVector,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  type Embedder,
} from '@curios/embeddings';
import { questionKey, retrievalText, selectForQuestion } from './retrieval.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

function axis(index: number): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMS);
  vector[index] = 1;
  return vector;
}

/**
 * A claim exactly 200 characters long, unique per index.
 *
 * Thirty of these hold about 6,000 characters, comfortably over
 * FACT_BUDGET_CHARS (4,000) -- unlike the ~85-character claim this fixture
 * used to carry, which put every seeded page under the budget and made it
 * impossible for a test to observe the budget actually binding.
 */
function claimOfLength(index: number, length = 200): string {
  const prefix = `Fakta nombor ${index}: `;
  const filler =
    'lapan puluh aksara sahaja tidak mencukupi untuk menguji bajet retrieval, jadi fakta ini ' +
    'sengaja dipanjangkan supaya jumlah kandungan tiga puluh fakta melebihi bajet retrieval ' +
    'yang ditetapkan bagi halaman ini. '.repeat(3);
  return (prefix + filler).slice(0, length);
}

/** An embedder that always answers with `axis(0)` and counts its calls. */
function embedderAnswering(vector: Float32Array = axis(0)) {
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector));
  const embedder: Embedder = { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, embed };
  return { embedder, embed };
}

/** A page of `count` facts. Fact `i` gets `axis(i % 8)`, unless `skipVectors`. */
async function seedPage(count: number, options: { vectors?: boolean; model?: string } = {}) {
  const facts = Array.from({ length: count }, (_unused, index) => ({
    id: `fact-${index}`,
    claim: claimOfLength(index),
  }));

  const account = await prisma.account.create({
    data: {
      email: `r${Date.now()}@example.com`,
      pages: {
        create: {
          handle: `r${Date.now()}`,
          skeleton: `r${Date.now()}`,
          displayName: 'Retrieval',
          published: true,
          facts: {
            create: facts.map((fact) => ({
              category: 'PRICE' as const,
              claim: fact.claim,
              normalizedClaim: fact.claim.toLowerCase(),
              confidence: 1,
              verified: true,
            })),
          },
        },
      },
    },
    include: { pages: { include: { facts: true } } },
  });

  const page = account.pages[0];
  if (!page) throw new Error('seed produced no page');

  if (options.vectors !== false) {
    await prisma.factEmbedding.createMany({
      data: page.facts.map((fact, index) => ({
        factId: fact.id,
        vector: encodeVector(index === 0 ? axis(0) : axis(1)),
        model: options.model ?? EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
      })),
    });
  }

  return { pageId: page.id, facts: page.facts.map((f) => ({ id: f.id, claim: f.claim })) };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "QuestionEmbedding" CASCADE');
});

// The beforeEach above clears QuestionEmbedding before every test but not
// after the last one -- so this file, run alone, used to leave a row behind:
// QuestionEmbedding does not cascade from Account (global-constraints.md),
// and this file is the one place selectForQuestion's cache-write path is
// exercised most heavily.
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "QuestionEmbedding" CASCADE');
});

describe('retrievalText', () => {
  it('is the question alone when there is no previous turn', () => {
    expect(retrievalText('berapa harga kek', null)).toBe('berapa harga kek');
  });

  // "how about the chocolate one" scores against nothing on its own.
  it('carries the previous turn, so a follow-up knows what it is about', () => {
    expect(retrievalText('yang coklat pula?', 'berapa harga kek butter')).toContain(
      'berapa harga kek butter',
    );
    expect(retrievalText('yang coklat pula?', 'berapa harga kek butter')).toContain(
      'yang coklat pula?',
    );
  });
});

describe('questionKey', () => {
  it('is the same for two phrasings that normalise the same', () => {
    expect(questionKey('Berapa harga kek?')).toBe(questionKey('berapa   harga kek'));
  });

  it('differs for different questions', () => {
    expect(questionKey('berapa harga kek')).not.toBe(questionKey('pukul berapa buka'));
  });

  // Not the text. This table is global across every page in the product, and
  // a column of raw visitor questions is a liability nobody asked for.
  it('is a fixed-width digest, not the text', () => {
    expect(questionKey('berapa harga kek')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('selectForQuestion', () => {
  it('falls back with no embedder, and spends nothing', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);

    const result = await selectForQuestion(
      { prisma, embedder: null },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('no-embedder');
    expect(result.facts).toHaveLength(RETRIEVAL_MIN_FACTS + 5);
  });

  // The check that must happen before the embedding call, not after it: a
  // small page paying for a vector it will throw away is the whole saving,
  // backwards.
  it('never calls the embedder for a page under the minimum', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS - 1);
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('below-minimum');
    expect(embed).not.toHaveBeenCalled();
  });

  it('never calls the embedder when a fact has no vector', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5, { vectors: false });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('missing-vectors');
    expect(embed).not.toHaveBeenCalled();
  });

  // A vector from another model is not comparable with one from this model.
  // Ignored at the read, so the missing-vector rule covers both cases.
  it('ignores vectors written by another model', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5, { model: 'older-model' });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('missing-vectors');
    expect(embed).not.toHaveBeenCalled();
  });

  // A row can be present, with metadata that matches this embedder's model
  // and dims, and still hold bytes that do not decode to that many
  // dimensions -- a corrupted column, not a stale model or width. Before the
  // fix this reviewed, decodeVector's throw was outside every try/catch in
  // this function and would fail the visitor's whole turn. It must instead
  // land in the same place a genuinely missing vector does: fall back,
  // spend nothing, and never let the question reach the log.
  it("falls back when a fact's vector cannot be decoded, rather than fail the turn", async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const [corrupted] = facts;
    if (!corrupted) throw new Error('seed produced no facts');
    // Metadata matches (model, dims) but the byte length does not decode to
    // EMBEDDING_DIMS floats -- exactly the case the model/dims filter in the
    // findMany where-clause cannot catch, because it never inspects bytes.
    await prisma.factEmbedding.update({
      where: { factId: corrupted.id },
      data: { vector: new Uint8Array(3) },
    });
    const { embedder, embed } = embedderAnswering();
    const info = vi.fn();

    const result = await selectForQuestion(
      { prisma, embedder, log: { info } },
      { pageId, facts, question: 'berapa harga kek butter', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('missing-vectors');
    expect(result.facts).toEqual(facts);
    // Before any spend, same as a genuinely missing vector: the decode
    // failure is caught before the embedder is ever reached.
    expect(embed).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain('berapa harga kek butter');
  });

  it('retrieves when everything is in place', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder } = embedderAnswering(axis(0));

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('retrieved');
    expect(result.facts.length).toBeLessThan(facts.length);
    expect(result.facts[0]?.id).toBe(facts[0]?.id);
  });

  it('falls back when the provider fails, and the answer is never blocked', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const embedder: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('provider-failed');
    expect(result.facts).toEqual(facts);
  });

  it('falls back when nothing on the page comes near the question', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    // Perpendicular to every stored vector: the best score is 0.
    const { embedder } = embedderAnswering(axis(7));

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'ada parking tak', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-floor');
    expect(result.facts).toEqual(facts);
  });

  it('stores the question vector, so the same question is never embedded twice', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();
    const ask = { pageId, facts, question: 'Berapa harga kek?', previousUserTurn: null };

    await selectForQuestion({ prisma, embedder }, ask);
    await selectForQuestion({ prisma, embedder }, { ...ask, question: 'berapa harga kek' });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(await prisma.questionEmbedding.count()).toBe(1);
  });

  // The cache is keyed on what was embedded. Keyed on the bare question
  // instead, a follow-up would be served the vector of the question asked on
  // its own -- a different question, and a wrong set of facts.
  it('keys the cache on the text it embedded, previous turn included', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();

    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'yang coklat?', previousUserTurn: null },
    );
    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'yang coklat?', previousUserTurn: 'berapa harga kek butter' },
    );

    expect(embed).toHaveBeenCalledTimes(2);
    expect(await prisma.questionEmbedding.count()).toBe(2);
  });

  it('ignores a stored question vector from another model and rewrites it', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    await prisma.questionEmbedding.create({
      data: {
        key: questionKey(retrievalText('berapa harga', null)),
        vector: encodeVector(axis(3)),
        model: 'older-model',
        dims: EMBEDDING_DIMS,
      },
    });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('retrieved');
    const row = await prisma.questionEmbedding.findFirstOrThrow();
    expect(row.model).toBe(EMBEDDING_MODEL);
  });

  // A gap the brief's own mutation table missed: the cache condition checks
  // `cached.model === embedder.model` but, before this test existed, nothing
  // exercised `cached.dims`. A row of the right model but a stale width is
  // not hypothetical -- it is exactly what a change to EMBEDDING_DIMS alone
  // (no model rename) would leave behind -- and decoding it against the
  // current width would once have thrown inside decodeVector, outside every
  // try/catch this function had -- crashing the visitor's whole turn rather
  // than simply re-embedding. A fix now wraps that decode, so this exact
  // mutation (removing the `cached.dims === embedder.dims` check) recovers
  // to the same visible outcome via the decode-failure path below rather
  // than failing; the dedicated test right after this one is what actually
  // proves that recovery. This test still stands for the cheap, no-decode
  // path: a metadata mismatch is caught before ever touching the bytes.
  it('ignores a stored question vector of a different width and rewrites it', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const staleDims = 3;
    await prisma.questionEmbedding.create({
      data: {
        key: questionKey(retrievalText('berapa harga', null)),
        vector: encodeVector(new Float32Array(staleDims)),
        model: EMBEDDING_MODEL,
        dims: staleDims,
      },
    });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('retrieved');
    const row = await prisma.questionEmbedding.findFirstOrThrow();
    expect(row.dims).toBe(EMBEDDING_DIMS);
  });

  // The other half of the same defence: metadata says this row matches (same
  // model, same dims), so the cheap check above lets it through, and only the
  // actual bytes are wrong -- a corrupted column, not a stale cache entry.
  // Before the fix this reviewed, decodeVector's throw here was uncaught and
  // would fail the visitor's turn outright. It must instead be treated
  // exactly like a cache miss: re-embed, and the row gets rewritten with
  // decodable bytes.
  it('re-embeds when a cached question vector cannot be decoded, rather than fail the turn', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    await prisma.questionEmbedding.create({
      data: {
        key: questionKey(retrievalText('berapa harga', null)),
        // Model and dims both match this embedder -- the metadata check
        // alone would let this row through -- but 3 bytes never decodes to
        // EMBEDDING_DIMS floats.
        vector: new Uint8Array(3),
        model: EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
      },
    });
    const { embedder, embed } = embedderAnswering();
    const info = vi.fn();

    const result = await selectForQuestion(
      { prisma, embedder, log: { info } },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('retrieved');
    const row = await prisma.questionEmbedding.findFirstOrThrow();
    // Rewritten with decodable bytes: the original 3-byte row is gone.
    expect(row.vector.length).toBe(EMBEDDING_DIMS * 4);
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain('berapa harga');
  });

  it('embeds the question with a query-shaped text and nothing else', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();

    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga kek', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledWith(['berapa harga kek']);
  });

  // Step 5's mutation table flags this exact mutant: `embedder.embed([text])`
  // -> `embedder.embed([input.question])` survives every test above, because
  // none of them both supplies a previousUserTurn AND asserts on the
  // embedder's actual argument. This one does both, so a caller who starts
  // embedding only the bare question on a follow-up cannot slip past unnoticed.
  it('embeds the combined text, not the bare question, when there is a previous turn', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();

    await selectForQuestion(
      { prisma, embedder },
      {
        pageId,
        facts,
        question: 'yang coklat pula?',
        previousUserTurn: 'berapa harga kek butter',
      },
    );

    expect(embed).toHaveBeenCalledWith(['berapa harga kek butter\nyang coklat pula?']);
  });

  it('logs the decision without the question in it', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder } = embedderAnswering();
    const info = vi.fn();

    await selectForQuestion(
      { prisma, embedder, log: { info } },
      { pageId, facts, question: 'berapa harga kek butter', previousUserTurn: null },
    );

    expect(info).toHaveBeenCalledOnce();
    const [details] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(details).toMatchObject({ pageId, mode: 'retrieved' });
    expect(JSON.stringify(details)).not.toContain('berapa harga kek butter');
  });
});

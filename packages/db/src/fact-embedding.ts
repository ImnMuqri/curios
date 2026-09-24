import type { Prisma, PrismaClient } from '@prisma/client';
import { EMBED_BATCH, encodeVector, type Embedder } from '@curios/embeddings';

/**
 * The only thing in the product that writes FactEmbedding rows.
 *
 * Three callers: the worker after an extraction, the backfill script, and the
 * golden runner after it seeds. They differ only in the `where` they pass, and
 * three loops over a batching API is how a batch size and a staleness rule
 * drift apart.
 *
 * "Needs a vector" means: not rejected, and either no row at all or a row
 * whose model or width does not match the embedder handed in. That last part
 * is what makes changing the embedding model a backfill rather than a
 * migration -- until it runs, every affected page sends every fact, which is
 * slow and expensive and never wrong.
 *
 * Unverified facts are embedded too. Chat reads only verified facts, so those
 * vectors sit unused -- but an owner clicking Accept must not drop their page
 * into fallback until the next crawl, and a page of vectors costs about two
 * thousandths of a sen.
 *
 * It does not catch: a caller decides whether a failure to embed is fatal.
 * The worker swallows it (an ingestion that wrote its facts succeeded), the
 * backfill reports it, the golden runner fails the run.
 */
export async function syncFactEmbeddings(
  prisma: PrismaClient,
  embedder: Embedder,
  where: Prisma.FactWhereInput,
  options: { batch?: number } = {},
): Promise<{ scanned: number; embedded: number }> {
  const batchSize = options.batch ?? EMBED_BATCH;

  const pending = await prisma.fact.findMany({
    where: {
      AND: [
        where,
        { rejectedAt: null },
        {
          OR: [
            { embedding: null },
            { embedding: { model: { not: embedder.model } } },
            { embedding: { dims: { not: embedder.dims } } },
          ],
        },
      ],
    },
    select: { id: true, question: true, claim: true },
    orderBy: { createdAt: 'asc' },
  });

  let embedded = 0;

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    // The question a customer would ask to get this claim, which is what a
    // visitor's question is matched against. The claim is the fallback for
    // facts written before Fact.question existed; the backfill script for
    // questions fills most of those in.
    const vectors = await embedder.embed(batch.map((fact) => fact.question ?? fact.claim));

    for (const [index, fact] of batch.entries()) {
      const vector = vectors[index];
      // Cannot happen -- the embedder contract rejects rather than returning
      // a short array -- but writing a row here without it would hand this
      // fact somebody else's vector.
      if (vector === undefined) {
        throw new Error(`No vector came back for fact ${fact.id}.`);
      }
      const row = { vector: encodeVector(vector), model: embedder.model, dims: embedder.dims };
      await prisma.factEmbedding.upsert({
        where: { factId: fact.id },
        create: { factId: fact.id, ...row },
        update: { ...row, createdAt: new Date() },
      });
      embedded += 1;
    }
  }

  return { scanned: pending.length, embedded };
}

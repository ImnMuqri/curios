import { syncFactEmbeddings, type Prisma, type PrismaClient } from '@curios/db';
import type { Embedder } from '@curios/embeddings';

export const EMBEDDINGS_BACKFILL_JOB = 'embeddings-backfill';

/**
 * Gives every fact that lacks a current vector one, the backfill script's own call on a schedule.
 * An ingestion or a fact edit whose embedding failed still saves the fact, by design, and nothing
 * else ever comes back for it: that page answers from every fact, correctly and at about twice the
 * cost, until this runs. A database with nothing to fix scans and writes nothing.
 */
export async function runEmbeddingsBackfill(deps: {
  prisma: PrismaClient;
  embedder: Embedder;
  log?: { info: (details: object, message: string) => void };
  /** Test-only: narrows the run to one page's facts, so a test does not re-embed the whole test database. */
  where?: Prisma.FactWhereInput;
}): Promise<{ scanned: number; embedded: number }> {
  const result = await syncFactEmbeddings(deps.prisma, deps.embedder, deps.where ?? {});
  if (result.scanned > 0) deps.log?.info(result, 'fact vectors backfilled');
  return result;
}

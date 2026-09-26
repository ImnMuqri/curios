import { config } from 'dotenv';
import { join } from 'node:path';
import { prisma, syncFactEmbeddings } from '@curios/db';
import {
  createOpenAiEmbedder,
  EMBEDDING_BATCH_TIMEOUT_MS,
  EMBEDDING_MODEL,
} from '@curios/embeddings';

// Resolved from this file's own location rather than the cwd, so the command
// below works from anywhere in the repo. Same trap seed-dev.ts documents.
config({ path: join(import.meta.dirname, '..', '.env') });

/**
 * Fills in the vectors for facts that already exist.
 *
 * Run it once after the migration that added FactEmbedding, and again any
 * time EMBEDDING_MODEL changes -- a fact whose stored vector came from
 * another model is re-embedded, not skipped. Until it has run, the pages it
 * covers answer from every fact they have, which is correct and roughly
 * twice the cost.
 *
 *   pnpm exec tsx scripts/backfill-fact-embeddings.ts
 *
 * It runs against whatever DATABASE_URL points at -- check that first. Safe to
 * re-run: it only ever selects facts that need a vector, so a second run does
 * nothing and costs nothing.
 */
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

const embedder = createOpenAiEmbedder(apiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });

console.log(`Embedding with ${EMBEDDING_MODEL} at ${embedder.dims} dimensions.`);

// An empty filter: every page. syncFactEmbeddings adds the rest of the rule
// -- not rejected, and no current vector.
const { scanned, embedded } = await syncFactEmbeddings(prisma, embedder, {});

console.log(`${scanned} facts needed a vector; ${embedded} written.`);

await prisma.$disconnect();

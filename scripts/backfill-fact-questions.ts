import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { join } from 'node:path';
import { prisma } from '@curios/db';
import { EXTRACT_MODEL } from '@curios/gateway';

// Resolved from this file's own location rather than the cwd, so the command
// below works from anywhere in the repo. Same trap seed-dev.ts documents.
config({ path: join(import.meta.dirname, '..', '.env') });

/**
 * ONE-OFF. Run once, after the migration that added Fact.question, then leave
 * it alone.
 *
 * It exists because extraction writes with skipDuplicates against
 * @@unique([pageId, normalizedClaim]), so re-crawling a page will never fill in
 * a question for a fact that already exists. Without this, every fact written
 * before that migration stays null forever and the ask bar has nothing to
 * cycle on exactly the pages that have been around longest.
 *
 *   pnpm exec tsx scripts/backfill-fact-questions.ts
 *
 * It spends one model call per batch of 25 facts, against whatever DATABASE_URL
 * points at -- check that before running it. Safe to re-run: it only ever
 * selects facts whose question is still null.
 *
 * Run `scripts/backfill-fact-embeddings.ts` immediately after this one. A fact
 * that already had a vector -- embedded from its claim, because it had no
 * question yet -- keeps matching against that claim forever otherwise:
 * `syncFactEmbeddings` (packages/db/src/fact-embedding.ts) only re-embeds a
 * fact with no vector or one from a different model or width, and writing a
 * question here does not by itself make the stored vector either. This script
 * clears each fact's vector in the same transaction as the question, so the
 * embeddings backfill picks it up as missing and re-embeds from the new
 * question rather than skipping it.
 */
const BATCH = 25;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

const client = new Anthropic({ apiKey });

const pending = await prisma.fact.findMany({
  where: { question: null, rejectedAt: null },
  select: { id: true, claim: true, category: true },
});

console.log(`${pending.length} facts without a question`);

for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  const numbered = batch.map((f, n) => `${n + 1}. [${f.category}] ${f.claim}`).join('\n');

  const message = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 2000,
    system:
      'For each numbered claim, write the question a customer would ask to get that claim as the answer. ' +
      'Same language as the claim, phrased the way a customer would type it, not the way a form would label it. ' +
      'Answer with one numbered line per claim and nothing else.',
    messages: [{ role: 'user', content: numbered }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Matched back by number rather than by position: a model that drops or
  // merges a line would otherwise shift every question onto the wrong fact,
  // which is silent, wrong, and worse than writing nothing.
  const answers = new Map<number, string>();
  for (const line of text.split('\n')) {
    const parsed = /^\s*(\d+)[.)]\s*(.+)$/.exec(line);
    if (parsed) answers.set(Number(parsed[1]), (parsed[2] ?? '').trim());
  }

  for (const [n, fact] of batch.entries()) {
    const question = answers.get(n + 1);
    if (!question) continue;
    // The vector is cleared in the same transaction as the question is
    // written, not left for a caller to remember separately -- see the
    // header comment for why a stale vector would otherwise survive this
    // script untouched. deleteMany rather than a nested relation delete: it
    // is a no-op when the fact has no embedding row yet, where a nested
    // `embedding: { delete: true }` would throw (P2025) on exactly the facts
    // that never had a vector to begin with.
    await prisma.$transaction([
      prisma.fact.update({ where: { id: fact.id }, data: { question } }),
      prisma.factEmbedding.deleteMany({ where: { factId: fact.id } }),
    ]);
  }

  console.log(`  ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
}

await prisma.$disconnect();

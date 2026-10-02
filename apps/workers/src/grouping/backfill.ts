import pino from 'pino';
import { prisma } from '@curios/db';
import { createAnthropicGateway } from '@curios/gateway';
import { createOpenAiEmbedder, EMBEDDING_BATCH_TIMEOUT_MS } from '@curios/embeddings';
import { pageIdFromArgs } from './backfill-args.js';
import { runGroupJob } from './group.job.js';

/**
 * Groups every undecided wording, page by page, oldest first, one at a time --
 * the same job the queue runs, so the one-off and the live path cannot
 * disagree. Safe to re-run: decided wordings are skipped.
 *
 *   pnpm --filter @curios/workers group:backfill            (every page)
 *   pnpm --filter @curios/workers group:backfill -- <pageId>
 */
async function main() {
  const log = pino({ name: 'group-backfill' });
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!anthropic || !openai) throw new Error('ANTHROPIC_API_KEY and OPENAI_API_KEY must be set');
  const deps = {
    prisma,
    gateway: createAnthropicGateway(anthropic),
    embedder: createOpenAiEmbedder(openai, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS }),
    log,
  };

  try {
    const onlyPage = pageIdFromArgs(process.argv.slice(2));
    const pending = await prisma.question.findMany({
      where: { groupedAt: null, pinnedByOwner: false, ...(onlyPage ? { pageId: onlyPage } : {}) },
      orderBy: [{ pageId: 'asc' }, { firstAskedAt: 'asc' }],
      select: { id: true, pageId: true },
    });

    const tally: Record<string, number> = {};
    for (const q of pending) {
      try {
        const outcome = await runGroupJob(deps, { questionId: q.id });
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (error) {
        tally.failed = (tally.failed ?? 0) + 1;
        log.error({ questionId: q.id, err: error instanceof Error ? error.message : String(error) }, 'grouping failed; left undecided');
      }
    }
    log.info({ wordings: pending.length, ...tally }, 'backfill done');
    if (tally.failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  pino({ name: 'group-backfill' }).error({ err: error instanceof Error ? error.message : String(error) }, 'backfill failed');
  process.exitCode = 1;
});

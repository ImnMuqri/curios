import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { helpGuide } from '@curios/core/help-guide';

/** How many of the latest the AI & usage screen lists. */
export const HELP_MISSES_SHOWN = 20;

/**
 * The questions the help guide failed, newest first, for AI & usage's Help section: asked in the
 * chat with no entry to answer them, or answered and marked "No". What to write the next entries
 * from. Through the API because the read-only role the admin app reads with cannot see whose
 * question it was or its words (the HelpQuestion migration). Rows whose words the 90-day sweep has
 * cleared are counts only and are not listed.
 *
 * Behind requireAdmin, added by the scope that registers this plugin.
 */
export const adminHelpRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/admin/help/misses', async () => {
    const rows = await app.prisma.helpQuestion.findMany({
      where: {
        question: { not: null },
        OR: [{ via: 'CHAT', ok: true, entryId: null }, { helped: false }],
      },
      orderBy: { createdAt: 'desc' },
      take: HELP_MISSES_SHOWN,
      select: {
        id: true,
        question: true,
        entryId: true,
        screen: true,
        sentToSupport: true,
        createdAt: true,
        account: { select: { email: true, pages: { select: { handle: true }, take: 1 } } },
      },
    });
    const questions = new Map(helpGuide().entries.map((e) => [e.id, e.question]));
    return {
      misses: rows.map((row) => ({
        id: row.id,
        question: row.question!,
        /** Null: not in the guide. Otherwise the entry that was marked "No". */
        entry: row.entryId ? { id: row.entryId, question: questions.get(row.entryId) ?? row.entryId } : null,
        screen: row.screen,
        sentToSupport: row.sentToSupport,
        createdAt: row.createdAt,
        owner: row.account ? { email: row.account.email, handle: row.account.pages[0]?.handle ?? null } : null,
      })),
    };
  });
};

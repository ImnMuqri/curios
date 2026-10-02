import { faqSlugBase, qualifiesForFaq } from '@curios/core';
import type { PrismaClient } from '@curios/db';

/** How many suffixed names to try before giving up on a slug. */
const MAX_ATTEMPTS = 20;

export interface Log {
  error: (obj: unknown, msg: string) => void;
  /**
   * Optional, unlike `error` above: this interface's only consumer that needs
   * it is the conversation cap's over-cap branch in chat.service.ts, logging
   * an expected, working-as-designed event rather than a failure. Every
   * existing caller of `assignTopicSlug` keeps compiling with an `error`-only
   * object; `request.log` (a Fastify/pino logger) already has both.
   */
  info?: (obj: unknown, msg: string) => void;
  /** Optional for the same reason: the chat's grouping-queue failure is logged here. */
  warn?: (obj: unknown, msg: string) => void;
}

/**
 * Give a topic its public URL, if it has earned one.
 *
 * Called from BOTH places that can complete the rule, because either condition
 * can be the last to arrive: the owner writing an answer, or a third visitor
 * asking. Wire only one and FAQ pages appear for some questions and never for
 * others, decided by the order an owner and a stranger happened to act -- a
 * bug that reads as randomness.
 *
 * Idempotent and best-effort. It re-runs on every ask and every answer edit
 * for the life of a topic, so doing nothing must be cheap and safe; and it
 * sits inside a visitor's chat request, so no failure here may become their
 * error. Everything is caught and logged.
 */
export async function assignTopicSlug(
  prisma: PrismaClient,
  topicId: string,
  log?: Log,
): Promise<void> {
  try {
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        pageId: true,
        title: true,
        askCount: true,
        answer: true,
        faqSlug: true,
        page: { select: { mode: true } },
      },
    });

    // Gone, or already named. Both are ordinary, and neither is an error.
    if (!topic || topic.faqSlug !== null) return;

    if (
      !qualifiesForFaq({
        mode: topic.page.mode,
        askCount: topic.askCount,
        answered: topic.answer !== null,
      })
    ) {
      return;
    }

    const base = faqSlugBase(topic.title);
    if (base === null) {
      log?.error({ topicId }, 'topic has no sluggable text; no faq url assigned');
      return;
    }

    // Read the taken names rather than guessing, then let the unique
    // constraint be the final arbiter -- two concurrent asks can both read
    // "free" and only one write can win. A retired slug (FaqRedirect) is taken
    // too: its old address may be ranking, or must stay a 404, and either way
    // it is never handed to another topic.
    const [held, retired] = await Promise.all([
      prisma.topic.findMany({
        where: { pageId: topic.pageId, faqSlug: { startsWith: base } },
        select: { faqSlug: true },
      }),
      prisma.faqRedirect.findMany({
        where: { pageId: topic.pageId, slug: { startsWith: base } },
        select: { slug: true },
      }),
    ]);
    const taken = new Set<string | null>([...held.map((r) => r.faqSlug), ...retired.map((r) => r.slug)]);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      if (taken.has(candidate)) continue;
      try {
        // Only onto a topic still unnamed: a merge or a concurrent assignment
        // may have named it since the read above, and that slug must survive.
        await prisma.topic.updateMany({
          where: { id: topic.id, faqSlug: null },
          data: { faqSlug: candidate },
        });
        return;
      } catch {
        // Almost certainly P2002 from a concurrent assignment. Try the next
        // name rather than inspecting the error code -- every other failure
        // here is also "could not take this name".
        taken.add(candidate);
      }
    }

    log?.error({ topicId, base }, 'could not find a free faq slug');
  } catch (error) {
    // The outer guard. An SEO URL is never worth failing a visitor's chat or
    // an owner's answer.
    log?.error({ err: error, topicId }, 'faq slug assignment failed');
  }
}

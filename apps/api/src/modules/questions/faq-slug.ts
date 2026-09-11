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
   * existing caller of `assignFaqSlug` keeps compiling with an `error`-only
   * object; `request.log` (a Fastify/pino logger) already has both.
   */
  info?: (obj: unknown, msg: string) => void;
}

/**
 * Give a question its public URL, if it has earned one.
 *
 * Called from BOTH places that can complete the rule, because either condition
 * can be the last to arrive: the owner writing an answer, or a third visitor
 * asking. Wire only one and FAQ pages appear for some questions and never for
 * others, decided by the order an owner and a stranger happened to act -- a
 * bug that reads as randomness.
 *
 * Idempotent and best-effort. It re-runs on every ask and every answer edit
 * for the life of a question, so doing nothing must be cheap and safe; and it
 * sits inside a visitor's chat request, so no failure here may become their
 * error. Everything is caught and logged.
 */
export async function assignFaqSlug(
  prisma: PrismaClient,
  questionId: string,
  log?: Log,
): Promise<void> {
  try {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        pageId: true,
        text: true,
        askCount: true,
        answered: true,
        faqSlug: true,
        page: { select: { mode: true } },
      },
    });

    // Gone, or already named. Both are ordinary, and neither is an error.
    if (!question || question.faqSlug !== null) return;

    if (
      !qualifiesForFaq({
        mode: question.page.mode,
        askCount: question.askCount,
        answered: question.answered,
      })
    ) {
      return;
    }

    const base = faqSlugBase(question.text);
    if (base === null) {
      log?.error({ questionId }, 'question has no sluggable text; no faq url assigned');
      return;
    }

    // Read the taken names rather than guessing, then let the unique
    // constraint be the final arbiter -- two concurrent asks can both read
    // "free" and only one write can win.
    const taken = new Set(
      (
        await prisma.question.findMany({
          where: { pageId: question.pageId, faqSlug: { startsWith: base } },
          select: { faqSlug: true },
        })
      ).map((row) => row.faqSlug),
    );

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      if (taken.has(candidate)) continue;
      try {
        await prisma.question.update({
          where: { id: question.id },
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

    log?.error({ questionId, base }, 'could not find a free faq slug');
  } catch (error) {
    // The outer guard. An SEO URL is never worth failing a visitor's chat or
    // an owner's answer.
    log?.error({ err: error, questionId }, 'faq slug assignment failed');
  }
}

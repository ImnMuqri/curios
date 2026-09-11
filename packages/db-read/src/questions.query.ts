import { prismaRead } from './client.js';

export interface OwnerQuestion {
  id: string;
  text: string;
  askCount: number;
  answered: boolean;
  lastAskedAt: Date;
  /** Non-null once the question has earned a public URL at /[handle]/faq. */
  faqSlug: string | null;
  /** True when the owner has taken that public page down. */
  faqSuppressed: boolean;
  /**
   * What the owner wrote, or null if nobody has answered yet. Present so the
   * editor can prefill and an owner can fix a typo -- without it the only way
   * to correct a published price is to delete the question and wait for three
   * more people to ask it.
   */
  answer: string | null;
}

/**
 * What customers actually ask, most asked first.
 *
 * Frequency is the only ranking. BACKEND.md's original design ranked by
 * whether the model refused; that is not detected and is not detectable across
 * three languages -- see its refusal rule. A question asked nine times is a gap
 * whether the model refused it or answered it badly, which makes the count the
 * more honest signal anyway.
 *
 * Scoped through the page's owner inside the query. A read-then-filter is one
 * careless early return away from showing a stranger's customers.
 */
export async function getQuestions(
  accountId: string,
  options: { limit?: number } = {},
): Promise<OwnerQuestion[]> {
  const questions = await prismaRead.question.findMany({
    where: { page: { accountId } },
    // Ask count, then recency: a tie between two questions asked twice is
    // broken by which is still being asked, and never left to the database's
    // discretion -- an unstable order makes the screen shuffle between loads.
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: Math.min(options.limit ?? 50, 100),
    select: {
      id: true,
      text: true,
      askCount: true,
      answered: true,
      lastAskedAt: true,
      faqSlug: true,
      faqSuppressed: true,
      normalizedQuestion: true,
    },
  });

  // Two indexed reads joined in memory, the same shape `getFaqIndex` uses and
  // for the same reason: `Question` and `PinnedAnswer` carry a matching unique
  // `(pageId, normalizedQuestion)` but no Prisma relation to walk.
  const answers = new Map(
    (
      await prismaRead.pinnedAnswer.findMany({
        where: {
          page: { accountId },
          normalizedQuestion: { in: questions.map((q) => q.normalizedQuestion) },
        },
        select: { normalizedQuestion: true, answer: true },
      })
    ).map((row) => [row.normalizedQuestion, row.answer]),
  );

  return questions.map(({ normalizedQuestion, ...question }) => ({
    ...question,
    answer: answers.get(normalizedQuestion) ?? null,
  }));
}

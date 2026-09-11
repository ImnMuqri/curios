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
  return prismaRead.question.findMany({
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
    },
  });
}

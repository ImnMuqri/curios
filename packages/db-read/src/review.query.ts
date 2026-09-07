import type { FactCategory } from '@curios/core';
import { prismaRead } from './client.js';

export interface ReviewFact {
  id: string;
  category: FactCategory;
  claim: string;
  /** What a customer would ask to reach this claim. Null for facts written before the column existed. */
  question: string | null;
  sourceText: string | null;
  sourceUrl: string | null;
  confidence: number;
}

/**
 * The facts this owner still has to answer for, oldest first.
 *
 * Scoped through the page's owner inside the query. A read-then-filter here
 * would be the same defect as the ingest IDOR, on a read path, and it would
 * leak another owner's `sourceText` -- which is a verbatim line from their
 * website.
 *
 * Verified facts are finished. Rejected facts were answered once already, and
 * the whole point of `rejectedAt` being a soft delete is not asking again.
 */
export async function getReviewQueue(
  accountId: string,
  options: { limit: number },
): Promise<ReviewFact[]> {
  return prismaRead.fact.findMany({
    where: { page: { accountId }, verified: false, rejectedAt: null },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(options.limit, 1), 100),
    select: {
      id: true,
      category: true,
      claim: true,
      question: true,
      sourceText: true,
      sourceUrl: true,
      confidence: true,
    },
  });
}

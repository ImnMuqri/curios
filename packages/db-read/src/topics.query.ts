import { prismaRead } from './client.js';

export interface OwnerWording {
  id: string;
  text: string;
  askCount: number;
}
export interface OwnerTopic {
  id: string;
  title: string;
  askCount: number;
  answer: string | null;
  conflictAnswer: string | null;
  faqSlug: string | null;
  faqSuppressed: boolean;
  lastAskedAt: Date;
  /** Most asked first; includes the title's wording. */
  wordings: OwnerWording[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** One row per topic, most asked first. Scoped through the page's owner in the query. */
export async function getTopics(accountId: string, options: { limit?: number } = {}): Promise<OwnerTopic[]> {
  const topics = await prismaRead.topic.findMany({
    where: { page: { accountId } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    select: {
      id: true,
      title: true,
      askCount: true,
      answer: true,
      conflictAnswer: true,
      faqSlug: true,
      faqSuppressed: true,
      lastAskedAt: true,
      questions: { orderBy: [{ askCount: 'desc' }, { firstAskedAt: 'asc' }], select: { id: true, text: true, askCount: true } },
    },
  });
  return topics.map(({ questions, ...topic }) => ({ ...topic, wordings: questions }));
}

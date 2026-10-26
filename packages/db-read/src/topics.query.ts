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
  /** Asks in each of the last seven days, oldest first, today last. Logged since 2026-10-17. */
  week: number[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One row per topic, most asked first. Scoped through the page's owner in the query. `offset` skips
 * that many, for the Questions screen's later pages; the id settles a tie, so pages never overlap.
 */
export async function getTopics(accountId: string, options: { limit?: number; offset?: number; now?: Date } = {}): Promise<OwnerTopic[]> {
  const now = options.now ?? new Date();
  const topics = await prismaRead.topic.findMany({
    where: { page: { accountId } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }, { id: 'asc' }],
    take: Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    skip: Math.max(options.offset ?? 0, 0),
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
  // The week of asks: rolling days back from now, so "today" is the last 24 hours.
  const asks = await prismaRead.questionAsk.findMany({
    where: { askedAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now }, question: { topicId: { in: topics.map((t) => t.id) } } },
    select: { askedAt: true, question: { select: { topicId: true } } },
  });
  const weeks = new Map<string, number[]>();
  for (const ask of asks) {
    const daysAgo = Math.floor((now.getTime() - ask.askedAt.getTime()) / DAY_MS);
    const week = weeks.get(ask.question.topicId) ?? [0, 0, 0, 0, 0, 0, 0];
    week[6 - daysAgo]! += 1;
    weeks.set(ask.question.topicId, week);
  }

  return topics.map(({ questions, ...topic }) => ({ ...topic, wordings: questions, week: weeks.get(topic.id) ?? [0, 0, 0, 0, 0, 0, 0] }));
}

/** How many of the last thirty days' asks the chat could answer, of those whose outcome was recorded. */
export interface AnswerRate {
  answered: number;
  recorded: number;
}

/**
 * The Questions screen's "Of asks the chat can answer": asks answered from the
 * owner's answer or the facts, against every ask whose outcome was recorded
 * (the chat marks each; the month's fixed reply is neither and is left out).
 */
export async function getAnswerRate(accountId: string, now = new Date()): Promise<AnswerRate> {
  const where = { askedAt: { gt: new Date(now.getTime() - 30 * DAY_MS), lte: now }, question: { page: { accountId } } };
  const [answered, recorded] = await Promise.all([
    prismaRead.questionAsk.count({ where: { ...where, answered: true } }),
    prismaRead.questionAsk.count({ where: { ...where, answered: { not: null } } }),
  ]);
  return { answered, recorded };
}

/** What visitors asked the page in the last seven days: every visitor turn, answered or not. */
export async function countQuestionsThisWeek(accountId: string, now = new Date()): Promise<number> {
  return prismaRead.message.count({
    where: { role: 'USER', createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now }, conversation: { page: { accountId } } },
  });
}

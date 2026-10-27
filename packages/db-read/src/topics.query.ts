import type { Prisma } from '@prisma/client';
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
  /** What the model last replied to it, and whether that was an answer or "not sure". Null until it has replied (kept since 2026-10-27). */
  chat: ChatReply | null;
}

/** The model's latest reply to a topic: which wording it was asked in, what it said, and whether it could answer. */
export interface ChatReply {
  asked: string;
  reply: string;
  answered: boolean;
  at: Date;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which topics a list shows: all; those needing the owner (no answer and the
 * chat was not sure, or never said, or two answers to choose from); those the
 * chat answered from the facts with no answer of the owner's; or those the
 * owner answered.
 */
export type TopicShow = 'all' | 'needs' | 'chat' | 'answered';

const ANSWERED = { answer: { not: null }, conflictAnswer: null };

/**
 * The topics with no owner answer whose latest model reply was an answer: the
 * chat copes with them on its own. Asks without a reply are skipped (the
 * owner's answer, the month's fixed reply, asks from before replies were
 * kept), so a topic only leaves "Needs you" on what the chat actually said.
 */
async function chatAnsweredIds(accountId: string): Promise<string[]> {
  const rows = await prismaRead.$queryRaw<{ topicId: string; answered: boolean }[]>`
    SELECT DISTINCT ON (q."topicId") q."topicId", a."answered"
    FROM "QuestionAsk" a
    JOIN "Question" q ON q."id" = a."questionId"
    JOIN "Topic" t ON t."id" = q."topicId"
    JOIN "Page" p ON p."id" = t."pageId"
    WHERE p."accountId" = ${accountId} AND t."answer" IS NULL AND a."reply" IS NOT NULL AND a."answered" IS NOT NULL
    ORDER BY q."topicId", a."askedAt" DESC, a."id" DESC`;
  return rows.filter((row) => row.answered).map((row) => row.topicId);
}

/** The same split as topicState on the screen: a topic with two answers to choose from still needs the owner. */
function showWhere(show: TopicShow, chatIds: string[]): Prisma.TopicWhereInput {
  if (show === 'needs') return { OR: [{ answer: null, id: { notIn: chatIds } }, { conflictAnswer: { not: null } }] };
  if (show === 'chat') return { answer: null, id: { in: chatIds } };
  if (show === 'answered') return ANSWERED;
  return {};
}

/**
 * One row per topic, most asked first. Scoped through the page's owner in the query. `offset` skips
 * that many, for the Questions screen's later pages; the id settles a tie, so pages never overlap.
 * `show` filters before paging, so a filtered list pages through every topic it matches.
 */
export async function getTopics(
  accountId: string,
  options: { limit?: number; offset?: number; now?: Date; show?: TopicShow } = {},
): Promise<OwnerTopic[]> {
  const now = options.now ?? new Date();
  const show = options.show ?? 'all';
  const topics = await prismaRead.topic.findMany({
    where: { page: { accountId }, ...showWhere(show, show === 'needs' || show === 'chat' ? await chatAnsweredIds(accountId) : []) },
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

  const replies = await latestReplies(topics.map((t) => t.id));

  return topics.map(({ questions, ...topic }) => ({
    ...topic,
    wordings: questions,
    week: weeks.get(topic.id) ?? [0, 0, 0, 0, 0, 0, 0],
    chat: replies.get(topic.id) ?? null,
  }));
}

/**
 * Each topic's latest ask the model replied to, whoever answers the topic now: withdrawing an
 * answer shows what the chat said before it. The ids go as one array parameter, not Prisma.join:
 * under next dev the Sql that join makes comes from another copy of @prisma/client than the
 * client, which then sends it as a JSON value (`text = jsonb`).
 */
async function latestReplies(topicIds: string[]): Promise<Map<string, ChatReply>> {
  if (topicIds.length === 0) return new Map();
  const rows = await prismaRead.$queryRaw<{ topicId: string; asked: string; reply: string; answered: boolean; at: Date }[]>`
    SELECT DISTINCT ON (q."topicId") q."topicId", q."text" AS "asked", a."reply", a."answered", a."askedAt" AS "at"
    FROM "QuestionAsk" a
    JOIN "Question" q ON q."id" = a."questionId"
    WHERE q."topicId" = ANY(${topicIds}::text[]) AND a."reply" IS NOT NULL AND a."answered" IS NOT NULL
    ORDER BY q."topicId", a."askedAt" DESC, a."id" DESC`;
  return new Map(rows.map(({ topicId, ...reply }) => [topicId, reply]));
}

/** Figures over every topic, not one screenful: how many each filter holds, and the asks behind them. */
export interface TopicTotals {
  /** Topics in each filter, for its count and its number of pages. */
  topics: Record<TopicShow, number>;
  /** Asks across all topics, and across the ones the owner answered. */
  asks: number;
  answeredAsks: number;
}

export async function getTopicTotals(accountId: string): Promise<TopicTotals> {
  const scope = { page: { accountId } };
  const chatIds = await chatAnsweredIds(accountId);
  const count = (show: TopicShow) => prismaRead.topic.count({ where: { ...scope, ...showWhere(show, chatIds) } });
  const [all, needs, answered, asks, answeredAsks] = await Promise.all([
    count('all'),
    count('needs'),
    count('answered'),
    prismaRead.topic.aggregate({ where: scope, _sum: { askCount: true } }),
    prismaRead.topic.aggregate({ where: { ...scope, ...ANSWERED }, _sum: { askCount: true } }),
  ]);
  return {
    topics: { all, needs, chat: chatIds.length, answered },
    asks: asks._sum.askCount ?? 0,
    answeredAsks: answeredAsks._sum.askCount ?? 0,
  };
}

/** What the sidebar's Questions badge counts: the "Needs you" filter. */
export async function countTopicsNeedingOwner(accountId: string): Promise<number> {
  return prismaRead.topic.count({ where: { page: { accountId }, ...showWhere('needs', await chatAnsweredIds(accountId)) } });
}

/** A topic another can be merged into: which answer it has decides which answer the merge keeps. */
export interface TopicChoice {
  id: string;
  title: string;
  answer: string | null;
}

/** Every topic, most asked first, for choosing one to merge into from any page of the list. */
export async function getTopicChoices(accountId: string): Promise<TopicChoice[]> {
  return prismaRead.topic.findMany({
    where: { page: { accountId } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }, { id: 'asc' }],
    take: 1000,
    select: { id: true, title: true, answer: true },
  });
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

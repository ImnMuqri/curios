import type { PrismaClient } from '@curios/db';
import { mergeTopics, refreshTopic } from '@curios/db';
import { ANSWER_MAX, TOPIC_TITLE_MAX } from '@curios/core';
import { assignTopicSlug } from '../questions/faq-slug.js';
import type { Log } from '../questions/faq-slug.js';

export class TopicNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404, not 403. A 403 confirms the id exists, which is itself a leak.
    super('No such question.');
    this.name = 'TopicNotFoundError';
  }
}
export class InvalidAnswerError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_ANSWER';
  constructor() {
    super(`Write an answer, up to ${ANSWER_MAX} characters.`);
    this.name = 'InvalidAnswerError';
  }
}
export class InvalidTitleError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_TITLE';
  constructor() {
    super(`Give it a title, up to ${TOPIC_TITLE_MAX} characters.`);
    this.name = 'InvalidTitleError';
  }
}
export class AlreadyAloneError extends Error {
  readonly statusCode = 400;
  readonly code = 'ALREADY_ALONE';
  constructor() {
    super('This is the only wording in its question already.');
    this.name = 'AlreadyAloneError';
  }
}
export class NoConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_CONFLICT';
  constructor() {
    super('There is only one answer here.');
    this.name = 'NoConflictError';
  }
}

const chars = (s: string) => [...s].length;

/** The topic, scoped to the owner in the query. */
async function ownTopic(prisma: PrismaClient, accountId: string, topicId: string) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, page: { accountId } },
    select: { id: true, pageId: true, answer: true, conflictAnswer: true },
  });
  if (!topic) throw new TopicNotFoundError();
  return topic;
}

/**
 * The writeback, and the one thing the questions screen is for: the topic's
 * single answer, which chat serves to every wording in it.
 */
export async function answerTopic(
  prisma: PrismaClient,
  accountId: string,
  topicId: string,
  raw: string,
  // Optional, and only for the slug assignment below: without it a qualifying
  // topic that fails to get a URL leaves no trace anywhere.
  log?: Log,
): Promise<void> {
  const answer = raw.trim();
  if (answer === '' || chars(answer) > ANSWER_MAX) throw new InvalidAnswerError();
  const { count } = await prisma.topic.updateMany({
    where: { id: topicId, page: { accountId } },
    data: { answer, answeredAt: new Date(), conflictAnswer: null },
  });
  if (count === 0) throw new TopicNotFoundError();
  // After the write, not with it: the answer is the owner's work and must
  // commit whatever happens to the URL; the slug is a consequence of it.
  await assignTopicSlug(prisma, topicId, log);
}

/** The owner no longer stands behind the answer. The slug is kept: a URL that has begun to rank must not move. */
export async function withdrawTopicAnswer(prisma: PrismaClient, accountId: string, topicId: string): Promise<void> {
  const { count } = await prisma.topic.updateMany({
    where: { id: topicId, page: { accountId } },
    data: { answer: null, answeredAt: null, conflictAnswer: null },
  });
  if (count === 0) throw new TopicNotFoundError();
}

/** Off the public FAQ, or back on. A flag, so the answer and the slug both survive. */
export async function setTopicSuppressed(
  prisma: PrismaClient,
  accountId: string,
  topicId: string,
  suppressed: boolean,
): Promise<void> {
  const { count } = await prisma.topic.updateMany({
    where: { id: topicId, page: { accountId } },
    data: { faqSuppressed: suppressed },
  });
  if (count === 0) throw new TopicNotFoundError();
}

export async function renameTopic(prisma: PrismaClient, accountId: string, topicId: string, raw: string): Promise<void> {
  const title = raw.trim();
  if (title === '' || /[\r\n]/.test(title) || chars(title) > TOPIC_TITLE_MAX) throw new InvalidTitleError();
  const { count } = await prisma.topic.updateMany({
    where: { id: topicId, page: { accountId } },
    data: { title, titleSetByOwner: true },
  });
  if (count === 0) throw new TopicNotFoundError();
}

export async function mergeTopic(
  prisma: PrismaClient,
  accountId: string,
  topicId: string,
  intoTopicId: string,
  keepAnswer: 'this' | 'into',
): Promise<void> {
  if (topicId === intoTopicId) throw new TopicNotFoundError();
  const from = await ownTopic(prisma, accountId, topicId);
  const into = await ownTopic(prisma, accountId, intoTopicId);
  if (from.pageId !== into.pageId) throw new TopicNotFoundError();
  await prisma.$transaction((tx) =>
    mergeTopics(tx, { fromTopicId: from.id, intoTopicId: into.id, answer: keepAnswer === 'this' ? 'from' : 'into' }),
  );
}

export async function resolveConflict(
  prisma: PrismaClient,
  accountId: string,
  topicId: string,
  keep: 'answer' | 'conflict',
): Promise<void> {
  const topic = await ownTopic(prisma, accountId, topicId);
  if (topic.conflictAnswer === null) throw new NoConflictError();
  await prisma.topic.updateMany({
    where: { id: topic.id, page: { accountId } },
    data:
      keep === 'conflict'
        ? { answer: topic.conflictAnswer, answeredAt: new Date(), conflictAnswer: null }
        : { conflictAnswer: null },
  });
}

export async function deleteTopic(prisma: PrismaClient, accountId: string, topicId: string): Promise<void> {
  const topic = await ownTopic(prisma, accountId, topicId);
  await prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { topicId: topic.id, page: { accountId } } });
    await refreshTopic(tx, topic.id); // empty -> deleted, slug retired with no target
  });
}

async function ownWording(prisma: PrismaClient, accountId: string, questionId: string) {
  const q = await prisma.question.findFirst({
    where: { id: questionId, page: { accountId } },
    select: { id: true, pageId: true, topicId: true, text: true },
  });
  if (!q) throw new TopicNotFoundError();
  return q;
}

export async function splitWording(prisma: PrismaClient, accountId: string, questionId: string): Promise<{ topicId: string }> {
  const q = await ownWording(prisma, accountId, questionId);
  return prisma.$transaction(async (tx) => {
    const siblings = await tx.question.count({ where: { topicId: q.topicId, id: { not: q.id } } });
    if (siblings === 0) throw new AlreadyAloneError();
    const topic = await tx.topic.create({ data: { pageId: q.pageId, title: q.text }, select: { id: true } });
    await tx.question.update({ where: { id: q.id }, data: { topicId: topic.id, pinnedByOwner: true, groupedAt: new Date() } });
    await refreshTopic(tx, topic.id);
    await refreshTopic(tx, q.topicId);
    return { topicId: topic.id };
  });
}

/**
 * Erase one wording: the customer's own words, and the right-to-erasure
 * primitive. A topic left with none is deleted with its answer; the title
 * moves if this wording was it.
 */
export async function deleteWording(prisma: PrismaClient, accountId: string, questionId: string): Promise<void> {
  const q = await ownWording(prisma, accountId, questionId);
  await prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { id: q.id, page: { accountId } } });
    await refreshTopic(tx, q.topicId);
  });
}

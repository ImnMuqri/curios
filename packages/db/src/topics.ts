import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Recompute a topic's aggregates from its wordings. Never increments: the
 * count is always re-derived from the rows that exist. Call it inside a
 * transaction: it first locks the topic row (FOR UPDATE), and under READ
 * COMMITTED every later statement then sees whatever a racing merge committed
 * while it waited, so a stale sum can never be written over a merge's result.
 * An empty topic is deleted, and its slug retired with no target so the old
 * address 404s and is never handed to another topic.
 */
export async function refreshTopic(tx: Tx, topicId: string): Promise<boolean> {
  await lockTopics(tx, [topicId]);
  const topic = await tx.topic.findUnique({
    where: { id: topicId },
    select: { id: true, pageId: true, faqSlug: true, titleSetByOwner: true },
  });
  if (!topic) return false;

  const wordings = await tx.question.findMany({
    where: { topicId },
    select: { text: true, askCount: true, firstAskedAt: true, lastAskedAt: true },
    orderBy: [{ askCount: 'desc' }, { firstAskedAt: 'asc' }, { id: 'asc' }],
  });

  if (wordings.length === 0) {
    if (topic.faqSlug) await retireSlug(tx, topic.pageId, topic.faqSlug, null);
    await tx.topic.delete({ where: { id: topicId } });
    return false;
  }

  const askCount = wordings.reduce((sum, w) => sum + w.askCount, 0);
  const lastAskedAt = new Date(Math.max(...wordings.map((w) => w.lastAskedAt.getTime())));
  await tx.topic.update({
    where: { id: topicId },
    data: {
      askCount,
      lastAskedAt,
      ...(topic.titleSetByOwner ? {} : { title: wordings[0]!.text }),
    },
  });
  return true;
}

/** Lock topic rows in a fixed (sorted) order, so concurrent callers cannot deadlock. */
async function lockTopics(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "Topic" WHERE "id" = ${id} FOR UPDATE`;
  }
}

export async function retireSlug(tx: Tx, pageId: string, slug: string, topicId: string | null): Promise<void> {
  await tx.faqRedirect.upsert({
    where: { pageId_slug: { pageId, slug } },
    create: { pageId, slug, topicId },
    update: { topicId },
  });
}

export async function mergeTopics(
  tx: Tx,
  input: { fromTopicId: string; intoTopicId: string; answer: 'from' | 'into' | 'auto' },
): Promise<void> {
  await lockTopics(tx, [input.fromTopicId, input.intoTopicId]);
  const select = { id: true, pageId: true, answer: true, answeredAt: true, askCount: true, faqSlug: true } as const;
  const from = await tx.topic.findUniqueOrThrow({ where: { id: input.fromTopicId }, select });
  const into = await tx.topic.findUniqueOrThrow({ where: { id: input.intoTopicId }, select });
  if (from.pageId !== into.pageId) throw new Error('mergeTopics: topics are on different pages');
  if (from.id === into.id) throw new Error('mergeTopics: a topic cannot merge into itself');

  let answer = into.answer;
  let answeredAt = into.answeredAt;
  let conflictAnswer: string | null | undefined;
  if (input.answer === 'from') {
    answer = from.answer;
    answeredAt = from.answeredAt;
  } else if (input.answer === 'auto' && from.answer !== null) {
    if (into.answer === null) {
      answer = from.answer;
      answeredAt = from.answeredAt;
    } else if (from.askCount > into.askCount) {
      conflictAnswer = into.answer;
      answer = from.answer;
      answeredAt = from.answeredAt;
    } else {
      conflictAnswer = from.answer;
    }
  }

  // The source's slug, if any, must be off the source before it can go onto
  // the survivor or into FaqRedirect: (pageId, faqSlug) is unique.
  const fromSlug = from.faqSlug;
  if (fromSlug) await tx.topic.update({ where: { id: from.id }, data: { faqSlug: null } });

  await tx.question.updateMany({ where: { topicId: from.id }, data: { topicId: into.id } });
  // Earlier redirects that pointed at the source now point at the survivor --
  // before the delete, whose SetNull would otherwise orphan them.
  await tx.faqRedirect.updateMany({ where: { topicId: from.id }, data: { topicId: into.id } });
  await tx.topic.delete({ where: { id: from.id } });

  let faqSlug = into.faqSlug;
  if (fromSlug) {
    if (faqSlug === null) faqSlug = fromSlug;
    else await retireSlug(tx, into.pageId, fromSlug, into.id);
  }

  await tx.topic.update({
    where: { id: into.id },
    data: { answer, answeredAt, faqSlug, ...(conflictAnswer !== undefined ? { conflictAnswer } : {}) },
  });
  await refreshTopic(tx, into.id);
}

export async function moveWording(tx: Tx, input: { questionId: string; intoTopicId: string }): Promise<void> {
  const question = await tx.question.findUniqueOrThrow({ where: { id: input.questionId }, select: { topicId: true, pageId: true } });
  const into = await tx.topic.findUniqueOrThrow({ where: { id: input.intoTopicId }, select: { pageId: true } });
  if (into.pageId !== question.pageId) throw new Error('moveWording: the topic is on a different page');
  await tx.question.update({ where: { id: input.questionId }, data: { topicId: input.intoTopicId } });
  await refreshTopic(tx, input.intoTopicId);
  await refreshTopic(tx, question.topicId);
}

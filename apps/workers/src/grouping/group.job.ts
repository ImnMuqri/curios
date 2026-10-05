import { type GroupJobData } from '@curios/core';
import { MergeWouldDropAnswerError, mergeTopics, moveWording, recordModelCall, shortlistTopics, type PrismaClient } from '@curios/db';
import { type Embedder } from '@curios/embeddings';
import { CHAT_MODEL, type Gateway } from '@curios/gateway';

export interface GroupJobDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  embedder: Embedder;
  log?: { warn?: (details: object, message: string) => void };
}

export type GroupOutcome = 'skipped' | 'alone' | 'none' | 'merged' | 'moved';

/**
 * Decide which topic a new wording belongs to. Only this wording ever moves:
 * alone in its topic, the topic merges into the match; sharing it, the
 * wording moves by itself. A wording the owner split out is never touched.
 */
export async function runGroupJob(deps: GroupJobDeps, data: GroupJobData): Promise<GroupOutcome> {
  const { prisma, gateway } = deps;
  const question = await prisma.question.findUnique({
    where: { id: data.questionId },
    select: {
      id: true, pageId: true, topicId: true, text: true, groupedAt: true, pinnedByOwner: true,
      page: { select: { displayName: true, mode: true } },
    },
  });
  if (!question || question.groupedAt !== null || question.pinnedByOwner) return 'skipped';

  const decided = () => prisma.question.update({ where: { id: question.id }, data: { groupedAt: new Date() } });

  // Every decided wording on the page outside this wording's own topic.
  const others = await prisma.question.findMany({
    where: { pageId: question.pageId, topicId: { not: question.topicId }, groupedAt: { not: null } },
    select: { text: true, topicId: true, topic: { select: { title: true } } },
  });
  if (others.length === 0) {
    await decided();
    return 'alone';
  }

  const shortlist = await shortlistTopics(
    deps,
    question.text,
    others.map((o) => ({ text: o.text, topicId: o.topicId, title: o.topic.title })),
  );
  if (shortlist.length === 0) {
    await decided();
    return 'alone';
  }

  let verdict;
  try {
    verdict = await gateway.sameQuestion({
      pageName: question.page.displayName,
      mode: question.page.mode,
      wording: question.text,
      candidates: shortlist,
    });
  } catch (error) {
    await recordModelCall(prisma, {
      pageId: question.pageId,
      model: CHAT_MODEL,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 0,
      ok: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    throw error;
  }

  await recordModelCall(prisma, {
    pageId: question.pageId,
    model: verdict.model,
    usage: verdict.usage,
    latencyMs: verdict.latencyMs,
    ok: true,
  });

  // Only an offered id counts; the gateway already maps letters to ids.
  const offered = new Set(shortlist.map((candidate) => candidate.id));
  if (verdict.match === null || !offered.has(verdict.match)) {
    await decided();
    return 'none';
  }
  const intoTopicId = verdict.match;

  const { pageId } = question;
  return prisma.$transaction(async (tx) => {
    // The model call took seconds. Lock the wording and look again: an owner's
    // split or merge made meanwhile wins, and nothing here may undo it.
    const [current] = await tx.$queryRaw<
      { id: string; topicId: string; groupedAt: Date | null; pinnedByOwner: boolean }[]
    >`SELECT "id", "topicId", "groupedAt", "pinnedByOwner" FROM "Question" WHERE "id" = ${question.id} FOR UPDATE`;
    if (!current || current.groupedAt !== null || current.pinnedByOwner || current.topicId !== question.topicId) {
      deps.log?.warn?.({ questionId: question.id }, 'grouping skipped: the wording changed while the model was answering');
      return 'skipped' as const;
    }
    const target = await tx.topic.findFirst({ where: { id: intoTopicId, pageId }, select: { id: true } });
    if (!target) {
      await tx.question.update({ where: { id: question.id }, data: { groupedAt: new Date() } });
      return 'none' as const;
    }
    const siblings = await tx.question.count({ where: { topicId: question.topicId, id: { not: question.id } } });
    await tx.question.update({ where: { id: question.id }, data: { groupedAt: new Date() } });
    if (siblings === 0) {
      try {
        await mergeTopics(tx, { fromTopicId: question.topicId, intoTopicId, answer: 'auto' });
      } catch (error) {
        // It throws before writing anything, so the transaction stays clean and
        // the wording's decided mark (set above) commits: the owner merges by hand.
        if (!(error instanceof MergeWouldDropAnswerError)) throw error;
        deps.log?.warn?.({ questionId: question.id, fromTopicId: question.topicId, intoTopicId }, 'grouping left alone: merging would drop an owner-written answer');
        return 'none' as const;
      }
      return 'merged' as const;
    }
    await moveWording(tx, { questionId: question.id, intoTopicId });
    return 'moved' as const;
  });
}

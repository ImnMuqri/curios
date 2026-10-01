import {
  cosineSimilarity,
  GROUP_CANDIDATES,
  GROUP_SAMPLE_WORDINGS,
  GROUP_SHORTLIST_MIN,
  questionKey,
  type GroupJobData,
} from '@curios/core';
import { MergeWouldDropAnswerError, mergeTopics, moveWording, recordModelCall, type PrismaClient } from '@curios/db';
import { decodeVector, encodeVector, type Embedder } from '@curios/embeddings';
import { CHAT_MODEL, type Gateway } from '@curios/gateway';

export interface GroupJobDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  embedder: Embedder;
  log?: { warn?: (details: object, message: string) => void };
}

export type GroupOutcome = 'skipped' | 'alone' | 'none' | 'merged' | 'moved';

/** Texts per embed call, so a page's first grouping never sends one enormous request. */
const EMBED_CHUNK = 100;

/** Vectors for these texts: the shared cache first, one batch call for the rest. */
async function vectorsFor(deps: GroupJobDeps, texts: string[]): Promise<Map<string, Float32Array>> {
  const { prisma, embedder } = deps;
  const keys = new Map(texts.map((t) => [t, questionKey(t)]));
  const cached = await prisma.questionEmbedding.findMany({
    where: { key: { in: [...new Set(keys.values())] }, model: embedder.model, dims: embedder.dims },
    select: { key: true, vector: true },
  });
  const byKey = new Map(cached.map((row) => [row.key, decodeVector(row.vector, embedder.dims)]));

  const missing = [...new Set(texts.filter((t) => !byKey.has(keys.get(t)!)))];
  for (let from = 0; from < missing.length; from += EMBED_CHUNK) {
    const chunk = missing.slice(from, from + EMBED_CHUNK);
    const fresh = await embedder.embed(chunk);
    for (const [i, text] of chunk.entries()) {
      const vector = fresh[i];
      if (!vector) continue;
      const key = keys.get(text)!;
      byKey.set(key, vector);
      const row = { vector: encodeVector(vector), model: embedder.model, dims: embedder.dims };
      await prisma.questionEmbedding.upsert({ where: { key }, create: { key, ...row }, update: row });
    }
  }

  return new Map(texts.flatMap((t) => {
    const v = byKey.get(keys.get(t)!);
    return v ? [[t, v] as const] : [];
  }));
}

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

  const vectors = await vectorsFor(deps, [question.text, ...others.map((o) => o.text)]);
  const mine = vectors.get(question.text);
  if (!mine) throw new Error('no vector for the wording being grouped');

  const byTopic = new Map<string, { title: string; best: number; wordings: { text: string; score: number }[] }>();
  for (const other of others) {
    const v = vectors.get(other.text);
    if (!v) continue;
    const score = cosineSimilarity(mine, v);
    const entry = byTopic.get(other.topicId) ?? { title: other.topic.title, best: -1, wordings: [] };
    entry.best = Math.max(entry.best, score);
    entry.wordings.push({ text: other.text, score });
    byTopic.set(other.topicId, entry);
  }

  const shortlist = [...byTopic.entries()]
    .filter(([, t]) => t.best >= GROUP_SHORTLIST_MIN)
    .sort((a, b) => b[1].best - a[1].best)
    .slice(0, GROUP_CANDIDATES);
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
      candidates: shortlist.map(([id, t]) => ({
        id,
        title: t.title,
        wordings: t.wordings.sort((a, b) => b.score - a.score).slice(0, GROUP_SAMPLE_WORDINGS).map((w) => w.text),
      })),
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
  const offered = new Set(shortlist.map(([id]) => id));
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

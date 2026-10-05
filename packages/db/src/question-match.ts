import { cosineSimilarity, GROUP_CANDIDATES, GROUP_SAMPLE_WORDINGS, GROUP_SHORTLIST_MIN, questionKey } from '@curios/core';
import { decodeVector, encodeVector, type Embedder } from '@curios/embeddings';
import type { SameQuestionCandidate } from '@curios/gateway';
import type { PrismaClient } from '@prisma/client';

/** Texts per embed call, so a page's first grouping never sends one enormous request. */
const EMBED_CHUNK = 100;

/** Vectors for these texts: the shared cache first, one batch call for the rest. */
export async function questionVectors(
  deps: { prisma: PrismaClient; embedder: Embedder },
  texts: string[],
): Promise<Map<string, Float32Array>> {
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
 * The topics worth asking the model about: every topic with a wording at
 * least GROUP_SHORTLIST_MIN close to this one, closest first, at most
 * GROUP_CANDIDATES, each with its closest few wordings. Empty when nothing is
 * close, which is the caller's cue to skip the model entirely.
 *
 * Shared by the two places that decide "is this the same question": the
 * grouping job, after a reply, and chat, before one -- so a visitor's new
 * wording of an answered question gets the owner's answer on its first ask,
 * not only after the job has merged it.
 */
export async function shortlistTopics(
  deps: { prisma: PrismaClient; embedder: Embedder },
  text: string,
  others: { text: string; topicId: string; title: string }[],
): Promise<SameQuestionCandidate[]> {
  if (others.length === 0) return [];
  const vectors = await questionVectors(deps, [text, ...others.map((o) => o.text)]);
  const mine = vectors.get(text);
  if (!mine) throw new Error('no vector for the wording being matched');

  const byTopic = new Map<string, { title: string; best: number; wordings: { text: string; score: number }[] }>();
  for (const other of others) {
    const v = vectors.get(other.text);
    if (!v) continue;
    const score = cosineSimilarity(mine, v);
    const entry = byTopic.get(other.topicId) ?? { title: other.title, best: -1, wordings: [] };
    entry.best = Math.max(entry.best, score);
    entry.wordings.push({ text: other.text, score });
    byTopic.set(other.topicId, entry);
  }

  return [...byTopic.entries()]
    .filter(([, t]) => t.best >= GROUP_SHORTLIST_MIN)
    .sort((a, b) => b[1].best - a[1].best)
    .slice(0, GROUP_CANDIDATES)
    .map(([id, t]) => ({
      id,
      title: t.title,
      wordings: t.wordings.sort((a, b) => b.score - a.score).slice(0, GROUP_SAMPLE_WORDINGS).map((w) => w.text),
    }));
}

import {
  questionKey,
  RETRIEVAL_MIN_FACTS,
  selectAnswers,
  selectFacts,
  type AnswerSelection,
  type FallbackReason,
} from '@curios/core';
import { questionVectors, type PrismaClient } from '@curios/db';
import { decodeVector, encodeVector, type Embedder } from '@curios/embeddings';

/**
 * The cache key for a question's vector lives in `@curios/core` so the grouping
 * worker computes the same one. Re-exported for the chat tests and the goldens.
 */
export { questionKey };

/**
 * Narrower than faq-slug.ts's `Log`: this module only ever logs at `info`
 * (a chosen-few, a floor miss, a fallback are all ordinary outcomes, never
 * failures), so `error` is not part of what a caller must supply. A
 * `ChatDeps.log` -- the full `Log`, `error` required -- still satisfies this
 * structurally; nothing has to build a second logger to call this function.
 */
export interface RetrievalLog {
  info?: (obj: unknown, msg: string) => void;
}

/**
 * Why an answer was built from every fact instead of a chosen few.
 *
 * Four of these come from the pure rule in `@curios/core`; the two named here
 * are states only a caller can be in. Every one of them ends in a correct
 * answer -- the only thing at stake is what it cost.
 */
export type RetrievalReason = FallbackReason | 'no-embedder' | 'provider-failed';

export interface ChatSelection<T> {
  mode: 'retrieved' | 'fallback';
  reason: RetrievalReason | null;
  /** Always what to send: the chosen facts, or every fact. */
  facts: T[];
  bestScore: number | null;
}

/**
 * The text that gets embedded for one turn.
 *
 * A follow-up carries the previous visitor turn with it. "yang coklat pula?"
 * matches nothing on its own -- it is a pronoun standing for whatever was
 * just discussed -- and a page that answers it from every fact is a page that
 * gave up on the cheapest turn in the conversation.
 *
 * Only the visitor's own previous turn, never the assistant's: the model's
 * answer is a paragraph of prose that would swamp a four-word question.
 */
export function retrievalText(question: string, previousUserTurn: string | null): string {
  return previousUserTurn === null ? question : `${previousUserTurn}\n${question}`;
}

/**
 * Which facts this question needs, and why.
 *
 * The order of the checks is the design. Everything answerable without
 * spending is answered first: no embedder, then a page too small to bother
 * with, then a page whose vectors are missing or stale. Only a page that
 * passes all three is worth an embedding call.
 *
 * Every failure returns every fact, which is what this product did before
 * retrieval existed. Nothing here can make an answer worse -- only more
 * expensive.
 */
export async function selectForQuestion<T extends { id: string; claim: string }>(
  deps: { prisma: PrismaClient; embedder: Embedder | null; log?: RetrievalLog },
  input: { pageId: string; facts: T[]; question: string; previousUserTurn: string | null },
): Promise<ChatSelection<T>> {
  const { prisma, embedder } = deps;
  const { pageId, facts } = input;

  const report = (selection: ChatSelection<T>): ChatSelection<T> => {
    // Ids, counts and a score. Never the question: this line goes to the
    // same log as everything else, and what a visitor typed is theirs.
    deps.log?.info?.(
      {
        pageId,
        mode: selection.mode,
        reason: selection.reason,
        bestScore: selection.bestScore,
        factCount: facts.length,
        selectedCount: selection.facts.length,
      },
      'chat retrieval',
    );
    return selection;
  };

  const everything = (reason: RetrievalReason): ChatSelection<T> =>
    report({ mode: 'fallback', reason, facts, bestScore: null });

  if (!embedder) return everything('no-embedder');

  // Before any query and before any spend. A twenty-fact page has nothing to
  // save and no reason to carry the risk; paying for a vector it would throw
  // away is this whole slice backwards.
  if (facts.length < RETRIEVAL_MIN_FACTS) return everything('below-minimum');

  // Read per question, never cached in this process. A cache would have to be
  // invalidated on every fact write, from two processes, and a stale vector
  // is a wrong answer -- two milliseconds is not worth that class of bug.
  //
  // Filtered to this embedder's model and width at the read, so a row from an
  // older model is simply absent and lands in the missing-vector rule below
  // rather than being scored against vectors from a different space.
  let rows;
  try {
    rows = await prisma.factEmbedding.findMany({
      where: {
        factId: { in: facts.map((fact) => fact.id) },
        model: embedder.model,
        dims: embedder.dims,
      },
      select: { factId: true, vector: true },
    });
  } catch {
    // A pool timeout, or this page hit by a rolling deploy before the
    // FactEmbedding migration landed, is for this function's purposes
    // indistinguishable from a page with no vectors yet: either way there is
    // no full, usable set to score against, and the visitor's turn must never
    // fail because the database hiccuped on a read this function can live
    // without. Reusing 'missing-vectors' rather than inventing a reason.
    return everything('missing-vectors');
  }

  if (rows.length !== facts.length) return everything('missing-vectors');

  let vectors: Map<string, Float32Array>;
  try {
    vectors = new Map(
      rows.map((row) => [row.factId, decodeVector(row.vector, embedder.dims)] as const),
    );
  } catch {
    // A row present but undecodable (byte length not a multiple of this
    // embedder's dims) is, for this function's purposes, indistinguishable
    // from a row that was never there: either way this page does not have a
    // full, usable set of vectors to score against. Reusing 'missing-vectors'
    // rather than inventing a reason -- the visitor's turn must never fail
    // because a byte column got corrupted.
    return everything('missing-vectors');
  }

  const question = await questionVector({ prisma, embedder }, retrievalText(input.question, input.previousUserTurn));
  if (question === null) return everything('provider-failed');

  const selection = selectFacts({ facts, vectors, question });
  return report(selection);
}

/**
 * The vector for what is embedded this turn: the cache first, the embedder on
 * a miss (written back, best effort), null when the provider fails. Shared by
 * the facts and the owner's answers, so one turn embeds its question at most
 * once -- the second caller finds the row the first one wrote.
 */
async function questionVector(
  deps: { prisma: PrismaClient; embedder: Embedder },
  text: string,
): Promise<Float32Array | null> {
  const { prisma, embedder } = deps;
  // Keyed on what is actually embedded, not on the bare question: a follow-up
  // embeds two turns, and a cache keyed on the question alone would hand it
  // the vector of a different question.
  const key = questionKey(text);

  let question: Float32Array | undefined;
  let cached;
  try {
    cached = await prisma.questionEmbedding.findUnique({
      where: { key },
      select: { vector: true, model: true, dims: true },
    });
  } catch {
    // Treated exactly like a cache miss, not a reason to fail the visitor's
    // turn: falling through embeds the question fresh, and the upsert below
    // -- already best-effort -- is what would write the row this read could
    // not reach.
    cached = null;
  }

  if (cached && cached.model === embedder.model && cached.dims === embedder.dims) {
    try {
      question = decodeVector(cached.vector, embedder.dims);
    } catch {
      // Corrupt bytes on an otherwise-matching row. Treated exactly like a
      // cache miss, not a reason to fail the visitor's turn: falling through
      // to the embed-and-overwrite branch below re-embeds the question and
      // rewrites this row with a decodable one, the same recovery a stale
      // model or width already gets.
      question = undefined;
    }
  }

  if (question === undefined) {
    let embedded: Float32Array | undefined;
    try {
      // The embedder holds its own deadline (EMBEDDING_TIMEOUT_MS on this
      // path). A visitor is watching a blank bubble, and an answer from every
      // fact is a correct answer -- waiting longer to make it a cheaper one
      // is the wrong trade.
      [embedded] = await embedder.embed([text]);
    } catch {
      return null;
    }
    if (embedded === undefined) return null;
    question = embedded;

    // Best effort. The answer does not depend on this row existing; the next
    // visitor asking the same thing pays for one more embedding call, which
    // is a fraction of a sen.
    const row = { vector: encodeVector(question), model: embedder.model, dims: embedder.dims };
    try {
      await prisma.questionEmbedding.upsert({
        where: { key },
        create: { key, ...row },
        update: row,
      });
    } catch {
      // Deliberately silent: a cache that failed to write is not an incident.
    }
  }

  return question;
}

/**
 * Which of the owner's own answers this question needs.
 *
 * They used to go into every prompt, up to thirty of them at up to 2,000
 * characters each. Now: all of them when they fit ANSWER_BUDGET_CHARS (no
 * embedding call, a stable prompt); otherwise the ones whose topic's wordings
 * are closest to this question, ranked by `selectAnswers` in @curios/core.
 * The wordings' vectors are the ones the grouping job already caches in
 * QuestionEmbedding. Any failure falls back to the most-asked answers that
 * fit -- bounded, and never a failed turn.
 */
export async function selectOwnerAnswers<T extends { id: string; question: string; answer: string }>(
  deps: { prisma: PrismaClient; embedder: Embedder | null; log?: RetrievalLog },
  input: { pageId: string; answers: T[]; question: string; previousUserTurn: string | null },
): Promise<AnswerSelection<T>> {
  const { prisma, embedder } = deps;
  const report = (selection: AnswerSelection<T>): AnswerSelection<T> => {
    deps.log?.info?.(
      { pageId: input.pageId, mode: selection.mode, bestScore: selection.bestScore, answerCount: input.answers.length, selectedCount: selection.answers.length },
      'chat answer retrieval',
    );
    return selection;
  };

  // Cheap first: under the budget, or nothing to rank with, needs no vectors at all.
  const unranked = selectAnswers({ answers: input.answers, vectors: null, question: null });
  if (unranked.mode === 'all' || !embedder) return report(unranked);

  try {
    const wordings = await prisma.question.findMany({
      where: { pageId: input.pageId, topicId: { in: input.answers.map((a) => a.id) } },
      select: { text: true, topicId: true },
    });
    const byText = await questionVectors({ prisma, embedder }, wordings.map((w) => w.text));
    const vectors = new Map<string, Float32Array[]>();
    for (const wording of wordings) {
      const vector = byText.get(wording.text);
      if (vector) vectors.set(wording.topicId, [...(vectors.get(wording.topicId) ?? []), vector]);
    }
    const question = await questionVector({ prisma, embedder }, retrievalText(input.question, input.previousUserTurn));
    return report(selectAnswers({ answers: input.answers, vectors, question }));
  } catch {
    return report(unranked);
  }
}

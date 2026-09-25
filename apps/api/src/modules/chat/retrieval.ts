import { createHash } from 'node:crypto';
import {
  normalizeClaim,
  RETRIEVAL_MIN_FACTS,
  selectFacts,
  type FallbackReason,
} from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { decodeVector, encodeVector, type Embedder } from '@curios/embeddings';

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
 * The key a question's vector is cached under.
 *
 * A digest of the normalised text, never the text. `QuestionEmbedding` is
 * global across every page in the product, so a text column there would be a
 * log of everything every visitor has ever asked anywhere -- something nobody
 * asked for and nothing needs. The hash also bounds the key: a follow-up can
 * reach a thousand characters, and Postgres' btree refuses a key over about
 * 2,700 bytes, which would throw on a visitor's question in production.
 */
export function questionKey(text: string): string {
  return createHash('sha256').update(normalizeClaim(text)).digest('hex');
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
  const rows = await prisma.factEmbedding.findMany({
    where: {
      factId: { in: facts.map((fact) => fact.id) },
      model: embedder.model,
      dims: embedder.dims,
    },
    select: { factId: true, vector: true },
  });

  if (rows.length !== facts.length) return everything('missing-vectors');

  const vectors = new Map(
    rows.map((row) => [row.factId, decodeVector(row.vector, embedder.dims)] as const),
  );

  const text = retrievalText(input.question, input.previousUserTurn);
  // Keyed on what is actually embedded, not on the bare question: a follow-up
  // embeds two turns, and a cache keyed on the question alone would hand it
  // the vector of a different question.
  const key = questionKey(text);

  let question: Float32Array;
  const cached = await prisma.questionEmbedding.findUnique({
    where: { key },
    select: { vector: true, model: true, dims: true },
  });

  if (cached && cached.model === embedder.model && cached.dims === embedder.dims) {
    question = decodeVector(cached.vector, embedder.dims);
  } else {
    let embedded: Float32Array | undefined;
    try {
      // The embedder holds its own deadline (EMBEDDING_TIMEOUT_MS on this
      // path). A visitor is watching a blank bubble, and an answer from every
      // fact is a correct answer -- waiting longer to make it a cheaper one
      // is the wrong trade.
      [embedded] = await embedder.embed([text]);
    } catch {
      return everything('provider-failed');
    }
    if (embedded === undefined) return everything('provider-failed');
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

  const selection = selectFacts({ facts, vectors, question });
  return report(selection);
}

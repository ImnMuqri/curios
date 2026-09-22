/**
 * Which facts a question needs.
 *
 * Pure, and here rather than in the chat module, for the same reason
 * `isOverCap` and `qualifies` are here: it is a rule the product is made of,
 * it is the rule most likely to be tuned, and a rule with a database
 * connection in it cannot be tested at the twenty cases it deserves.
 *
 * Every path returns facts to send. In fallback that is the whole list, which
 * is exactly what the product did before this slice -- so a caller that
 * ignores `mode` is still correct, only expensive.
 */

/**
 * Below this many verified facts, a page never retrieves.
 *
 * There is nothing to save on a small page -- twenty facts is under a
 * thousand tokens -- and no reason to carry the risk of dropping the one that
 * mattered. Every personal page lands here, and so do the three fixture pages
 * the golden set has had since slice 11.
 */
export const RETRIEVAL_MIN_FACTS = 25;

/**
 * Below this cosine, the best match is not a match.
 *
 * A visitor asking something the page does not cover must reach the model
 * with everything, so that the refusal is the model's judgement about the
 * whole page rather than an artefact of retrieval having found nothing.
 * 0.35 is a starting value, tuned against the golden set.
 */
export const RETRIEVAL_FLOOR = 0.35;

/**
 * How many characters of claims one answer may carry: roughly 1,150 tokens of
 * Malay prose, so a retrieved prompt is about 1,500 tokens against the ~6,000
 * a 114-fact page used to send.
 */
export const FACT_BUDGET_CHARS = 4000;

export type FallbackReason = 'below-minimum' | 'missing-vectors' | 'below-floor';

export interface Selection<T> {
  mode: 'retrieved' | 'fallback';
  /** Null in retrieved mode. */
  reason: FallbackReason | null;
  /** Always what to send: the selected facts, or every fact. */
  facts: T[];
  /** The best cosine seen, or null when scoring never happened. */
  bestScore: number | null;
}

/**
 * Cosine, computed from magnitudes rather than assumed.
 *
 * The provider returns unit vectors today, so a dot product would do. It is
 * computed properly anyway because the assumption is invisible when it breaks:
 * a provider that stops normalising would not fail, it would rank by length.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors of different width: ${a.length} and ${b.length}.`);
  }

  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    aSquared += left * left;
    bSquared += right * right;
  }

  // Zero magnitude means an unusable vector. Zero, not NaN: NaN compares
  // false against the floor, so it would read as an ordinary weak match and
  // hide the bug in a fallback that looks like a design working correctly.
  if (aSquared === 0 || bSquared === 0) return 0;

  return dot / (Math.sqrt(aSquared) * Math.sqrt(bSquared));
}

export function selectFacts<T extends { id: string; claim: string }>(input: {
  facts: T[];
  vectors: ReadonlyMap<string, Float32Array>;
  question: Float32Array;
  minFacts?: number;
  floor?: number;
  budgetChars?: number;
}): Selection<T> {
  const { facts, vectors, question } = input;
  const minFacts = input.minFacts ?? RETRIEVAL_MIN_FACTS;
  const floor = input.floor ?? RETRIEVAL_FLOOR;
  const budgetChars = input.budgetChars ?? FACT_BUDGET_CHARS;

  const everything = (reason: FallbackReason, bestScore: number | null = null): Selection<T> => ({
    mode: 'fallback',
    reason,
    facts,
    bestScore,
  });

  if (facts.length < minFacts) return everything('below-minimum');

  // Every fact, or none. A page missing one vector cannot be scored fairly:
  // the missing fact would be absent from the ranking rather than ranked
  // last, and it might be the one holding the price.
  const scored: { fact: T; score: number }[] = [];
  for (const fact of facts) {
    const vector = vectors.get(fact.id);
    if (vector === undefined) return everything('missing-vectors');
    scored.push({ fact, score: cosineSimilarity(question, vector) });
  }

  // Sort is stable in every engine this runs on, so facts of equal score keep
  // the order they arrived in -- which the chat path orders by createdAt, so
  // ties break towards the fact the owner has had longest.
  scored.sort((left, right) => right.score - left.score);

  const best = scored[0]?.score ?? 0;
  if (best < floor) return everything('below-floor', best);

  // The first fact is always taken, whatever its length: it scored above the
  // floor, and a prompt with no facts in it can only refuse a question the
  // page can answer. After that the budget ends the selection at the first
  // fact that would overflow -- never skipping past it to a shorter one,
  // which would make the set something other than the top N by score.
  const selected: T[] = [];
  let used = 0;
  for (const { fact } of scored) {
    if (selected.length > 0 && used + fact.claim.length > budgetChars) break;
    selected.push(fact);
    used += fact.claim.length;
  }

  return { mode: 'retrieved', reason: null, facts: selected, bestScore: best };
}

import { describe, expect, it } from 'vitest';
import {
  ANSWER_BUDGET_CHARS,
  cosineSimilarity,
  FACT_BUDGET_CHARS,
  RETRIEVAL_MIN_FACTS,
  selectAnswers,
  selectFacts,
} from './retrieval.js';

/** A unit vector pointing at one axis, so scores are exactly 1 or 0. */
function axis(index: number, dims = 8): Float32Array {
  const vector = new Float32Array(dims);
  vector[index] = 1;
  return vector;
}

/** A vector between two axes, so a score can sit at a chosen height. */
function between(a: number, b: number, weight: number, dims = 8): Float32Array {
  const vector = new Float32Array(dims);
  vector[a] = weight;
  vector[b] = 1 - weight;
  return vector;
}

/** `count` facts, each scoring against `axis(index)` by construction. */
function page(count: number, claim = 'x'.repeat(100)) {
  return Array.from({ length: count }, (_unused, index) => ({ id: `f${index}`, claim }));
}

function vectorsFor(facts: { id: string }[], make: (index: number) => Float32Array) {
  return new Map(facts.map((fact, index) => [fact.id, make(index)]));
}

describe('cosineSimilarity', () => {
  it('is 1 for the same direction', () => {
    expect(cosineSimilarity(axis(0), axis(0))).toBeCloseTo(1);
  });

  it('is 0 for perpendicular vectors', () => {
    expect(cosineSimilarity(axis(0), axis(1))).toBeCloseTo(0);
  });

  it('ignores magnitude', () => {
    const long = Float32Array.from(axis(0), (value) => value * 17);
    expect(cosineSimilarity(long, axis(0))).toBeCloseTo(1);
  });

  // Not NaN. A NaN score compares false against the floor, so a zero vector
  // would quietly read as "no good match" instead of as the bug it is.
  it('is 0 against a zero vector, never NaN', () => {
    expect(cosineSimilarity(new Float32Array(8), axis(0))).toBe(0);
  });

  it('refuses vectors of different widths', () => {
    expect(() => cosineSimilarity(new Float32Array(4), new Float32Array(8))).toThrow(/width/i);
  });
});

describe('selectFacts', () => {
  it('falls back on a page with fewer than the minimum facts', () => {
    const facts = page(RETRIEVAL_MIN_FACTS - 1);
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, axis),
      question: axis(0),
    });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-minimum');
    expect(result.facts).toHaveLength(RETRIEVAL_MIN_FACTS - 1);
    expect(result.bestScore).toBeNull();
  });

  it('retrieves on a page with exactly the minimum facts', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, (index) => axis(index % 8)),
      question: axis(0),
    });

    expect(result.mode).toBe('retrieved');
  });

  it('takes an overridden minFacts, so the golden set can tune it', () => {
    const facts = page(10);
    // Would fall back with default minFacts: 25
    const resultDefault = selectFacts({
      facts,
      vectors: vectorsFor(facts, axis),
      question: axis(0),
    });
    expect(resultDefault.mode).toBe('fallback');

    // Retrieves with minFacts: 5
    const resultOverride = selectFacts({
      facts,
      vectors: vectorsFor(facts, axis),
      question: axis(0),
      minFacts: 5,
    });
    expect(resultOverride.mode).toBe('retrieved');
  });

  it('falls back when one fact has no vector', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, (index) => axis(index % 8));
    vectors.delete('f7');

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('missing-vectors');
    expect(result.facts).toEqual(facts);
    expect(result.bestScore).toBeNull();
  });

  it('falls back when the best score is below the floor', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const result = selectFacts({
      // Every fact perpendicular to the question: the best score is 0.
      facts,
      vectors: vectorsFor(facts, () => axis(1)),
      question: axis(0),
    });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-floor');
    expect(result.bestScore).toBeCloseTo(0);
  });

  it('retrieves when the best score is exactly the floor', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    // One fact placed so its cosine against axis(0) is exactly the floor.
    const edge = Float32Array.from([0.35, Math.sqrt(1 - 0.35 ** 2), 0, 0, 0, 0, 0, 0]);
    vectors.set('f0', edge);
    const floor = cosineSimilarity(axis(0), edge);
    const result = selectFacts({ facts, vectors, question: axis(0), floor });

    expect(result.mode).toBe('retrieved');
    expect(result.reason).toBeNull();
  });

  it('returns facts in score order, best first', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    vectors.set('f3', axis(0));
    vectors.set('f9', between(0, 1, 0.9));

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts[0]?.id).toBe('f3');
    expect(result.facts[1]?.id).toBe('f9');
  });

  it('stops at the character budget rather than sending the page', () => {
    // 40 facts of 200 characters is 8,000 -- twice the budget.
    const facts = page(40, 'x'.repeat(200));
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, (index) => between(0, 1, 1 - index / 100)),
      question: axis(0),
    });

    expect(result.mode).toBe('retrieved');
    expect(result.facts.length).toBeLessThan(facts.length);
    const chars = result.facts.reduce((total, fact) => total + fact.claim.length, 0);
    expect(chars).toBeLessThanOrEqual(FACT_BUDGET_CHARS);
  });

  // The set is always the top N by score. Skipping over a fact that does not
  // fit and taking a lower-scoring shorter one puts a worse answer in front
  // of a visitor to save a few characters.
  it('ends the selection at the first fact that would overflow, never skipping past it', () => {
    const facts = [
      { id: 'best', claim: 'x'.repeat(3900) },
      { id: 'second', claim: 'x'.repeat(300) },
      { id: 'third', claim: 'x'.repeat(10) },
      ...page(RETRIEVAL_MIN_FACTS, 'x'.repeat(10)),
    ];
    const vectors = new Map<string, Float32Array>([
      ['best', axis(0)],
      ['second', between(0, 1, 0.9)],
      ['third', between(0, 1, 0.8)],
      ...page(RETRIEVAL_MIN_FACTS).map(
        (fact) => [fact.id, axis(1)] as [string, Float32Array],
      ),
    ]);

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts.map((fact) => fact.id)).toEqual(['best']);
  });

  // Nothing at all is worse than one long fact: the question matched it above
  // the floor, and a prompt with no facts in it can only refuse.
  it('always sends the best fact, even when it alone exceeds the budget', () => {
    const facts = [
      { id: 'huge', claim: 'x'.repeat(FACT_BUDGET_CHARS + 500) },
      ...page(RETRIEVAL_MIN_FACTS, 'x'.repeat(10)),
    ];
    const vectors = new Map<string, Float32Array>([
      ['huge', axis(0)],
      ...page(RETRIEVAL_MIN_FACTS).map(
        (fact) => [fact.id, axis(1)] as [string, Float32Array],
      ),
    ]);

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts.map((fact) => fact.id)).toEqual(['huge']);
  });

  it('reports the best score it saw, for logging', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    vectors.set('f2', axis(0));

    expect(selectFacts({ facts, vectors, question: axis(0) }).bestScore).toBeCloseTo(1);
  });

  it('takes an overridden floor and budget, so the golden set can tune them', () => {
    const facts = page(RETRIEVAL_MIN_FACTS, 'x'.repeat(100));
    const vectors = vectorsFor(facts, (index) => between(0, 1, 0.9 - index / 100));

    const tight = selectFacts({ facts, vectors, question: axis(0), budgetChars: 250 });
    expect(tight.facts).toHaveLength(2);

    const strict = selectFacts({ facts, vectors, question: axis(0), floor: 0.999 });
    expect(strict.mode).toBe('fallback');
  });
});

describe('selectAnswers', () => {
  const answer = (id: string, length = 900) => ({ id, question: `q ${id}`, answer: 'x'.repeat(length) });

  it('sends every answer, with no vectors needed, when they all fit the budget', () => {
    const answers = [answer('a', 100), answer('b', 100)];
    expect(selectAnswers({ answers, vectors: null, question: null })).toEqual({ mode: 'all', answers, bestScore: null });
  });

  it('past the budget, sends only the answers whose wordings are close to the question, closest first', () => {
    const answers = [answer('a'), answer('b'), answer('c')];
    const vectors = new Map([
      ['a', [axis(1)]],
      ['b', [axis(2), axis(0)]], // one of its wordings is the question
      ['c', [axis(3)]],
    ]);
    const selection = selectAnswers({ answers, vectors, question: axis(0) });
    expect(selection.mode).toBe('retrieved');
    expect(selection.answers.map((a) => a.id)).toEqual(['b']);
    expect(selection.bestScore).toBe(1);
  });

  it('sends none of them when nothing is close: the facts still answer', () => {
    const answers = [answer('a'), answer('b'), answer('c')];
    const vectors = new Map([['a', [axis(1)]], ['b', [axis(2)]], ['c', [axis(3)]]]);
    expect(selectAnswers({ answers, vectors, question: axis(0) }).answers).toEqual([]);
  });

  it('falls back to the most-asked that fit when there is nothing to rank with, never to all of them', () => {
    const answers = [answer('a'), answer('b'), answer('c')];
    const selection = selectAnswers({ answers, vectors: null, question: null });
    expect(selection.mode).toBe('most-asked');
    expect(selection.answers.map((a) => a.id)).toEqual(['a', 'b']);
    expect(selection.answers.reduce((n, a) => n + a.question.length + a.answer.length, 0)).toBeLessThanOrEqual(ANSWER_BUDGET_CHARS);
  });

  it('always keeps the closest answer, even one longer than the budget on its own', () => {
    const answers = [answer('a', 2400), answer('b', 2400)];
    const vectors = new Map([['a', [axis(0)]], ['b', [axis(1)]]]);
    expect(selectAnswers({ answers, vectors, question: axis(0) }).answers.map((a) => a.id)).toEqual(['a']);
  });
});

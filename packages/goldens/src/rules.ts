/**
 * What a question asserts about its answer. Every field is optional and only
 * the ones present are applied, so a question says what it cares about and
 * nothing more.
 */
export interface Expectation {
  /** Each string must appear in the answer, case-insensitively. */
  mustContain?: string[];
  /** None of these may appear. This is how a refusal is asserted. */
  mustNotContain?: string[];
  /** Every number in the answer must come from a fact, or from the question. */
  digitsOnlyFromFacts?: boolean;
  /** Advisory. Reported, never failed. */
  language?: 'ms' | 'en';
}

/** One rule's verdict on one answer. */
export interface RuleVerdict {
  /** Identifies the rule and its argument, e.g. `mustContain:95`. */
  rule: string;
  passed: boolean;
  /** Advisory verdicts are reported and never fail a run. */
  advisory: boolean;
  /** Why it failed, when saying so needs more than the rule's name. */
  detail?: string;
}

/**
 * A dozen common words per language. Deliberately crude: this check is
 * advisory, and the honest description of it is "usually right", which is
 * worth reporting and not worth failing a run over.
 */
const LANGUAGE_MARKERS: Record<'ms' | 'en', string[]> = {
  ms: ['harga', 'boleh', 'ada', 'tak', 'kami', 'pukul', 'buka', 'tempah', 'sila', 'untuk', 'tidak', 'saya'],
  en: ['the', 'is', 'are', 'we', 'you', 'open', 'price', 'order', 'please', 'can', 'from', 'sorry'],
};

/**
 * Every number in a piece of text, as whole tokens.
 *
 * Thousands separators are removed first, so a fact written "RM1,200" and an
 * answer written "RM1200" are the same number rather than a false failure. The
 * decimal point stays: "9.50" is one number, not a 9 and a 50 -- otherwise a
 * rounded price passes by matching its own first digit against some unrelated
 * fact.
 *
 * Each token then goes through `Number`, so "RM95.00" in an answer matches
 * "RM95" in a fact. Writing a price with cents is not inventing one, and a rule
 * that cried wolf over it would be the first one anyone learned to ignore.
 */
export function numbersIn(text: string): string[] {
  const withoutThousands = text.replace(/(?<=\d),(?=\d{3})/g, '');
  const tokens = withoutThousands.match(/\d+(?:\.\d+)?/g) ?? [];
  return tokens.map((token) => String(Number(token)));
}

/**
 * Every rule that applies to one answer, with its verdict.
 *
 * Pure on purpose: no database, no clock, no model. It is the one part of this
 * harness that can be tested exhaustively and cheaply, so it holds all of the
 * judgement and the runner holds none.
 */
export function checkAnswer(input: {
  answer: string;
  question: string;
  facts: string[];
  neverSay: string[];
  expect: Expectation;
}): RuleVerdict[] {
  const { answer, question, facts, neverSay, expect } = input;
  const haystack = answer.toLowerCase();
  const verdicts: RuleVerdict[] = [];

  if (expect.digitsOnlyFromFacts) {
    // The question's own numbers count as known. Asked "diskaun untuk 10
    // kotak", a good answer says "10 kotak" back, and that invents nothing.
    const allowed = new Set([...numbersIn(facts.join(' ')), ...numbersIn(question)]);
    const invented = numbersIn(answer).filter((n) => !allowed.has(n));
    verdicts.push({
      rule: 'digitsOnlyFromFacts',
      passed: invented.length === 0,
      advisory: false,
      detail: invented.length > 0 ? `in no fact and not in the question: ${invented.join(', ')}` : undefined,
    });
  }

  for (const needle of expect.mustContain ?? []) {
    verdicts.push({
      rule: `mustContain:${needle}`,
      passed: haystack.includes(needle.toLowerCase()),
      advisory: false,
    });
  }

  for (const needle of expect.mustNotContain ?? []) {
    verdicts.push({
      rule: `mustNotContain:${needle}`,
      passed: !haystack.includes(needle.toLowerCase()),
      advisory: false,
    });
  }

  // Page-wide, and applied to every answer on the page rather than named by
  // each question: a NeverSay phrase is a promise the whole page makes.
  for (const phrase of neverSay) {
    verdicts.push({
      rule: `neverSay:${phrase}`,
      passed: !haystack.includes(phrase.toLowerCase()),
      advisory: false,
    });
  }

  if (expect.language) {
    const markers = LANGUAGE_MARKERS[expect.language];
    verdicts.push({
      rule: `language:${expect.language}`,
      passed: markers.some((marker) => new RegExp(`\\b${marker}`, 'i').test(answer)),
      advisory: true,
    });
  }

  return verdicts;
}

/** A question failed when any rule that is not advisory failed. */
export function failed(verdicts: RuleVerdict[]): boolean {
  return verdicts.some((verdict) => !verdict.passed && !verdict.advisory);
}

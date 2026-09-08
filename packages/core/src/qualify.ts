/** BACKEND.md's `turn_3`. Two turns is still browsing. */
export const MIN_VISITOR_TURNS = 3;

/**
 * A standalone number: a quantity, a count, a date. BACKEND.md calls this
 * `own_specifics`, and "own" is the load-bearing word -- it is the visitor
 * stating their own requirement, not the assistant quoting a price.
 *
 * Not preceded by a letter or another digit, which is the distinction that
 * matters: "2kg" is a quantity and "b2b" is a word with a digit in it. Guarding
 * only against adjacent digits lets "b2b" through -- found by the test, not by
 * reading. A bare \d anywhere would qualify almost any message, which is
 * exactly the inflated lead count this rule exists to avoid.
 */
const SPECIFIC = /(?<![A-Za-z\d])\d+/;

/**
 * Whether the capture card may be offered.
 *
 * Deterministic, and deliberately so. BACKEND.md originally specified a model
 * returning a confidence score; why that changed is argued in
 * devDocs/slice-4-build-spec.md, and the shortest version is that "be
 * conservative" is a requirement you can tune and unit-test in a function and
 * cannot in a 0.81.
 *
 * Under-capturing is the intended failure direction. A card shown to somebody
 * checking opening hours costs the owner's trust in every number on their
 * dashboard; a card not shown to a real lead costs one lead, and slice 5's
 * Questions dashboard is the named mechanism for finding those.
 *
 * `visitorMessages` is the visitor's side only. The caller does that filtering
 * because only the caller knows which rows are whose.
 */
export function qualifies(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  visitorMessages: string[];
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  if (input.visitorMessages.length < MIN_VISITOR_TURNS) return false;
  return input.visitorMessages.some((message) => SPECIFIC.test(message));
}

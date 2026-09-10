/**
 * BACKEND.md: "do not generate FAQ pages for questions nobody asked, that is
 * content farm behaviour and it will read as one."
 *
 * Three, not one: one ask is somebody asking, but a page per stray question is
 * a hundred thin pages, which is the shape of the thing that rule forbids.
 * Three, not five: these are small shops, and a threshold that generates
 * nothing for two months is a feature that dies before anyone sees it work.
 */
export const FAQ_MIN_ASKS = 3;

/** Long enough to stay readable, short enough for a sane URL. */
const SLUG_MAX = 60;

/**
 * Whether a question may become a public page.
 *
 * Deterministic and in one place, the same argument `qualifies` settled for
 * lead capture in slice 4: a rule you can unit-test in a function beats a rule
 * you tune in a prompt or a config table.
 *
 * `askCount` and `answered` are not redundant. The count is evidence of
 * demand, `answered` is evidence that the owner wrote the words themselves,
 * and a public page wants both.
 */
export function qualifiesForFaq(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  askCount: number;
  answered: boolean;
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  if (input.askCount < FAQ_MIN_ASKS) return false;
  return input.answered;
}

/**
 * The slug for a question, before any collision suffix.
 *
 * `\p{L}` rather than `[a-z]`: Malay is Latin script and survives either way,
 * but the ask bar takes any language and a slug of empty segments is worse
 * than a slug with a non-ASCII letter in it.
 *
 * Null, not '', when nothing survives. An empty slug written to the column
 * would be a unique value that resolves to a route rendering nothing, and the
 * caller must be forced to notice.
 */
export function faqSlugBase(questionText: string): string | null {
  const slug = questionText
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    // Slicing can leave a trailing separator where it cut mid-separator.
    .replace(/-+$/g, '');

  return slug.length > 0 ? slug : null;
}

/**
 * A JSON-LD payload safe to place inside a script element.
 *
 * `JSON.stringify` escapes quotes and backslashes and leaves `<` alone,
 * because `<` is legal inside a JSON string. That is enough for an answer
 * containing a closing script tag to end the element early and have everything
 * after it parsed as HTML -- script injection into a public page, reachable by
 * any owner who can write an answer.
 *
 * Escaping `<` to its unicode form is still valid JSON and parses back to the
 * identical object, so nothing is lost but the ability to close a tag.
 *
 * One function that does both steps, so no caller can serialise and forget to
 * escape.
 */
export function serialiseJsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

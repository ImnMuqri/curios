/**
 * What a page may spend on model answers in a calendar month, counted in
 * conversations rather than messages -- a chatty visitor costs one unit.
 *
 * 200 is roughly seven conversations a day. It is a guess, and the spec says
 * so: slice 1 was right that a cap cannot be chosen without volume data, and
 * wrong that nothing could be built without it. The mechanism does not need
 * the data; only the number does, which is what the override below is for.
 */
export const FREE_CONVERSATIONS_PER_MONTH = 200;

/**
 * The cap in force, letting operations tune it without a deploy.
 *
 * Deliberately the same shape as `limit()` in the API's rate-limit plugin,
 * including refusing a zero: a cap of zero would take every page dark, which
 * is the one outcome BACKEND.md rules out, and failing at boot is louder than
 * serving nothing.
 */
export function conversationCap(): number {
  const raw = process.env.CONVERSATION_CAP_PER_MONTH;
  if (raw === undefined || raw === '') return FREE_CONVERSATIONS_PER_MONTH;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `CONVERSATION_CAP_PER_MONTH must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

/**
 * Whether this page has spent its month.
 *
 * `>` and not `>=`, which is the whole of the arithmetic and easy to get
 * backwards. The counter is incremented when the conversation is created,
 * which happens ABOVE the place this is called, so on the Nth conversation of
 * a month `used` already reads N. `>=` would refuse the 200th and deliver 199.
 */
export function isOverCap(input: { used: number; cap: number }): boolean {
  return input.used > input.cap;
}

/**
 * How a read reports its progress while the model streams its answer.
 *
 * The answer is fact blocks separated by `---` lines. A block is complete once
 * the separator after it has arrived, so everything before the last separator
 * can be parsed and written while the rest is still coming.
 *
 * Progress is where the latest fact's excerpt sits in the source: the model
 * reads in order, so a fact quoted from three quarters down means about three
 * quarters read. Fetching the source is the first stretch of the bar, writing
 * the last facts and their embeddings the final one.
 */

/** Fetched, before the model has said anything. */
export const PROGRESS_FETCHED = 10;
/** The most the reading itself can claim; the rest is for finishing up. */
export const PROGRESS_READ = 95;

const SEPARATOR = /^\s*---\s*$/gm;

/** The part of a streaming answer whose blocks are complete: all of it before the last separator. */
export function completedPart(raw: string): string {
  let end = -1;
  for (const match of raw.matchAll(SEPARATOR)) end = match.index;
  return end < 0 ? '' : raw.slice(0, end);
}

/** Lowercased, whitespace collapsed: an excerpt and its source rarely agree on spacing. */
const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Where reading has got to, given the source and the latest fact's excerpt;
 * null when the excerpt cannot be found in it (paraphrased, or translated).
 */
export function progressAt(source: string, excerpt: string | null | undefined): number | null {
  const needle = squash(excerpt ?? '');
  const haystack = squash(source);
  if (!needle || !haystack) return null;
  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  const through = (at + needle.length) / haystack.length;
  return Math.round(PROGRESS_FETCHED + through * (PROGRESS_READ - PROGRESS_FETCHED));
}

/**
 * The next figure to show: never backwards (a fact quoted from earlier in
 * the page does not undo reading), and a small step when the excerpt is not
 * found, so a read whose quotes cannot be placed still visibly moves.
 */
export function nextProgress(current: number, found: number | null): number {
  if (found === null) return Math.min(PROGRESS_READ, current + 3);
  return Math.min(PROGRESS_READ, Math.max(current, found));
}

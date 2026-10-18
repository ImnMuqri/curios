/** At most this much of the source either side of an excerpt. */
const REACH = 90;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The words either side of a fact's excerpt in its source, for Review's line
 * ("Kek Coklat Moist. **1kg RM95, 2kg RM170**. Order 2 days ahead."), as the
 * board draws it: what the page says just before and just after. Found
 * ignoring case and spacing, since the model's quote rarely keeps the page's
 * line breaks. Each side is at most the one sentence next to it, within about
 * 90 characters; it stops at a line break (a different line is a different
 * thing), and otherwise at a whole word.
 * Null when the excerpt is not in the source as written (paraphrased, or
 * translated).
 */
export function contextAround(source: string, excerpt: string | null | undefined): { before: string; after: string } | null {
  const words = (excerpt ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const found = new RegExp(words.map(escape).join('\\s+'), 'i').exec(source);
  if (!found) return null;

  const start = found.index;
  const end = start + found[0].length;

  // Before: back to the start of the sentence before the excerpt, at most.
  let before = source.slice(Math.max(0, start - REACH), start);
  const line = before.lastIndexOf('\n');
  const sentence = Math.max(...['. ', '! ', '? '].map((mark) => before.replace(/[.!?]\s*$/, '').lastIndexOf(mark)));
  if (line >= 0 || sentence >= 0) before = before.slice(Math.max(line + 1, sentence + 2));
  else if (start > REACH) before = before.slice(before.indexOf(' ') + 1);

  // After: on to the end of the sentence after it, at most.
  let after = source.slice(end, end + REACH);
  const breakAt = after.indexOf('\n');
  if (breakAt >= 0) after = after.slice(0, breakAt);
  const stop = after.slice(1).search(/[.!?](\s|$)/);
  if (stop >= 0) after = after.slice(0, stop + 2);
  else if (breakAt < 0 && end + REACH < source.length) after = after.slice(0, Math.max(0, after.lastIndexOf(' ')));

  return { before: before.replace(/\s+/g, ' ').trimStart(), after: after.replace(/\s+/g, ' ').trimEnd() };
}

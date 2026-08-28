/**
 * The dedupe key for facts and the match key for pinned answers.
 *
 * Two claims that a person would call the same claim must produce the same
 * string here, or the same price gets stored twice and a pinned answer misses
 * on a trailing question mark.
 */
export function normalizeClaim(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    // Keep letters (any script, so Malay and Chinese survive), digits, and spaces.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

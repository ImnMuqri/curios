/** Long enough to read, short enough for a link someone pastes into a chat. */
const SLUG_MAX = 60;

/**
 * The link word for an item, made once from its name when the item is
 * created and never changed after, so a link already shared keeps working
 * when the owner renames the item.
 *
 * ASCII only, [a-z0-9-]: accents are folded to their letters (Malay and
 * French names survive), and a name with no Latin letters at all (Chinese,
 * Tamil) falls back to "item". `taken` is the page's other slugs; a clash
 * gets -2, -3 and so on.
 *
 * Imports nothing, like store.ts, so it is safe in client bundles.
 */
export function itemSlug(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX)
      .replace(/-+$/g, '') || 'item';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

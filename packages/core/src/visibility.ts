/**
 * Who may see a page: a visitor reaches it only once the owner has published
 * it AND the Curios team has not suspended it. Every visitor-facing read
 * filters on this one definition, so suspending a page takes it down
 * everywhere at once and no surface can forget the second condition.
 */
export const PUBLIC_PAGE_WHERE = { published: true, suspendedAt: null } as const;

/** The same rule for a row already in hand. */
export function isPageLive(page: { published: boolean; suspendedAt: Date | null }): boolean {
  return page.published && page.suspendedAt === null;
}

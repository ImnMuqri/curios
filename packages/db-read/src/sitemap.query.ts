import { PUBLIC_PAGE_WHERE } from '@curios/core';
import { prismaRead } from './client.js';

export interface SitemapPage {
  handle: string;
  /** Its shop is open: `/handle/shop` is a page. */
  shop: boolean;
  /** Every FAQ entry with a public URL and an answer, most asked first. */
  faqSlugs: string[];
}

/** The sitemap protocol's limit for one file; past it the list stops, oldest pages first in. */
export const SITEMAP_URL_LIMIT = 50_000;

/**
 * Every page a search engine may index, with its shop and FAQ entries, for `/sitemap.xml`.
 *
 * The same gates the pages use, written as a query: live (`PUBLIC_PAGE_WHERE`), and indexable
 * by `shouldIndex`'s rule -- every business page, a personal page only when its owner opted in.
 * FAQ pages and shops are business-only, and an entry is listed only while its route would serve
 * it (`getFaqIndex`'s filter). Oldest pages first, so the URLs that fit under the limit are stable.
 */
export async function getSitemapPages(): Promise<SitemapPage[]> {
  const pages = await prismaRead.page.findMany({
    where: { ...PUBLIC_PAGE_WHERE, OR: [{ mode: 'BUSINESS' }, { allowSearchIndexing: true }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    // Each page is at least one URL, so more than the limit can never all fit.
    take: SITEMAP_URL_LIMIT,
    select: {
      handle: true,
      mode: true,
      storeEnabled: true,
      topics: {
        where: { faqSlug: { not: null }, faqSuppressed: false, answer: { not: null } },
        orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
        select: { faqSlug: true },
      },
    },
  });

  return pages.map((page) => {
    const business = page.mode === 'BUSINESS';
    return {
      handle: page.handle,
      shop: business && page.storeEnabled,
      faqSlugs: business ? page.topics.map((topic) => topic.faqSlug as string) : [],
    };
  });
}

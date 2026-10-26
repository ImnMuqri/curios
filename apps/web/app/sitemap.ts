import type { MetadataRoute } from 'next';
import { getSitemapPages, SITEMAP_URL_LIMIT } from '@curios/db-read';
import { SITE_URL } from './_landing/structured-data.js';
import { LEGAL_DOCS, LEGAL_PATH } from './_legal/content.js';

// Read from the database on each request rather than at build time, which may have no database.
// Crawlers ask for it rarely; the query is one read of the indexable pages.
export const dynamic = 'force-dynamic';

/**
 * The landing page and the Terms, Privacy and Refund pages, each in both languages; then every
 * page search may index, with its FAQ list and entries and its shop (`getSitemapPages` carries
 * the rules). One file holds 50,000 URLs, so the list stops there.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const languages = { 'en-MY': SITE_URL, 'ms-MY': `${SITE_URL}/ms` };
  const legal = LEGAL_DOCS.flatMap((doc) => {
    const docLanguages = { 'en-MY': `${SITE_URL}${LEGAL_PATH.en[doc]}`, 'ms-MY': `${SITE_URL}${LEGAL_PATH.ms[doc]}` };
    return (['en', 'ms'] as const).map((locale) => ({
      url: `${SITE_URL}${LEGAL_PATH[locale][doc]}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
      alternates: { languages: docLanguages },
    }));
  });
  const site: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ms`, changeFrequency: 'monthly', priority: 0.9, alternates: { languages } },
    ...legal,
  ];

  const pages = (await getSitemapPages()).flatMap((page): MetadataRoute.Sitemap => {
    const base = `${SITE_URL}/${page.handle}`;
    return [
      { url: base, changeFrequency: 'weekly', priority: 0.8 },
      ...(page.shop ? [{ url: `${base}/shop`, changeFrequency: 'weekly' as const, priority: 0.7 }] : []),
      ...(page.faqSlugs.length > 0 ? [{ url: `${base}/faq`, changeFrequency: 'weekly' as const, priority: 0.6 }] : []),
      ...page.faqSlugs.map((slug) => ({ url: `${base}/faq/${slug}`, changeFrequency: 'monthly' as const, priority: 0.5 })),
    ];
  });
  return [...site, ...pages].slice(0, SITEMAP_URL_LIMIT);
}

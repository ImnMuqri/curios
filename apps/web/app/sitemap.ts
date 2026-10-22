import type { MetadataRoute } from 'next';
import { SITE_URL } from './_landing/structured-data.js';
import { LEGAL_DOCS, LEGAL_PATH } from './_legal/content.js';

/**
 * The landing page and the Terms, Privacy and Refund pages, each in both
 * languages. Business pages and their FAQ pages are not listed yet: that
 * needs a read of every indexable page, and is its own change (README.md in
 * app/_landing, "Not done").
 */
export default function sitemap(): MetadataRoute.Sitemap {
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
  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ms`, changeFrequency: 'monthly', priority: 0.9, alternates: { languages } },
    ...legal,
  ];
}

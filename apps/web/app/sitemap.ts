import type { MetadataRoute } from 'next';
import { SITE_URL } from './_landing/structured-data.js';

/**
 * The landing page in both languages. Business pages and their FAQ pages are
 * not listed yet: that needs a read of every indexable page, and is its own
 * change (README.md in app/_landing, "Not done").
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { 'en-MY': SITE_URL, 'ms-MY': `${SITE_URL}/ms` };
  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ms`, changeFrequency: 'monthly', priority: 0.9, alternates: { languages } },
  ];
}

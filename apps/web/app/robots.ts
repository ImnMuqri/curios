import type { MetadataRoute } from 'next';
import { SITE_URL } from './_landing/structured-data.js';

/**
 * Crawl everything public. The owner dashboard is behind a session anyway;
 * disallowing it just keeps crawlers from spending their budget on redirects
 * to /signin. Personal pages are kept out of search by their own noindex tag
 * (app/[handle]/page.tsx), which robots.txt must not block, or the crawler
 * would never see the tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app/', '/verify', '/reset'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

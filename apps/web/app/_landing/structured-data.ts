import type { PlanTerms } from '@curios/core/settings';
import type { LandingCopy } from './copy.js';

export const SITE_URL = 'https://curios.my';

/**
 * Other names people search for. "Curios" alone is a dictionary word (curio, curios), so
 * these tell Google which site the brand is; it also uses them when it picks a site name.
 */
const ALTERNATE_NAMES = ['Curios.my', 'Curios Malaysia'];

/**
 * JSON-LD for the landing page: the organisation, the site, the product with
 * both plans as offers, and the FAQ built from the same list the page shows.
 *
 * No BreadcrumbList: the landing page is the root of the site, and a
 * breadcrumb with one crumb tells a search engine nothing.
 * No AggregateRating or Review: there are none yet, and inventing them is
 * against both DESIGN.md and Google's rules.
 *
 * `prices` are the ones in force, the same the page's copy was built from, so
 * the offers can never quote a price the page beside them does not.
 */
export function structuredData(copy: LandingCopy, url: string, prices: PlanTerms['prices']) {
  const inLanguage = copy.locale === 'ms' ? 'ms-MY' : 'en-MY';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: 'Curios',
        alternateName: ALTERNATE_NAMES,
        url: SITE_URL,
        // A raster logo: Google's logo guidelines want one it can show at 112px or more.
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/apple-icon.png`, width: 180, height: 180 },
        areaServed: { '@type': 'Country', name: 'Malaysia' },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: 'Curios',
        alternateName: ALTERNATE_NAMES,
        publisher: { '@id': `${SITE_URL}/#organization` },
        inLanguage: ['en-MY', 'ms-MY'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'Curios',
        url,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: copy.meta.description,
        inLanguage,
        publisher: { '@id': `${SITE_URL}/#organization` },
        offers: [
          {
            '@type': 'Offer',
            name: copy.pricing.personal.name,
            price: '0',
            priceCurrency: 'MYR',
          },
          {
            '@type': 'Offer',
            name: `${copy.pricing.business.name} (monthly)`,
            price: String(prices.MONTHLY / 100),
            priceCurrency: 'MYR',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: String(prices.MONTHLY / 100),
              priceCurrency: 'MYR',
              billingDuration: 'P1M',
            },
          },
          {
            '@type': 'Offer',
            name: `${copy.pricing.business.name} (yearly)`,
            price: String(prices.ANNUAL / 100),
            priceCurrency: 'MYR',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: String(prices.ANNUAL / 100),
              priceCurrency: 'MYR',
              billingDuration: 'P1Y',
            },
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage,
        mainEntity: copy.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };
}

/** JSON inside a <script> tag: escape "<" so no string in the copy can close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

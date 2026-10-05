import type { LandingCopy } from './copy.js';

export const SITE_URL = 'https://curios.my';

/**
 * JSON-LD for the landing page: the organisation, the site, the product with
 * both plans as offers, and the FAQ built from the same list the page shows.
 *
 * No BreadcrumbList: the landing page is the root of the site, and a
 * breadcrumb with one crumb tells a search engine nothing.
 * No AggregateRating or Review: there are none yet, and inventing them is
 * against both DESIGN.md and Google's rules.
 */
export function structuredData(copy: LandingCopy, url: string) {
  const inLanguage = copy.locale === 'ms' ? 'ms-MY' : 'en-MY';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: 'Curios',
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        areaServed: { '@type': 'Country', name: 'Malaysia' },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: 'Curios',
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
            price: '39',
            priceCurrency: 'MYR',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '39',
              priceCurrency: 'MYR',
              billingDuration: 'P1M',
            },
          },
          {
            '@type': 'Offer',
            name: `${copy.pricing.business.name} (yearly)`,
            price: '390',
            priceCurrency: 'MYR',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '390',
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

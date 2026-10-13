import type { Metadata } from 'next';
import './landing-tokens.css';
import { COPY, type Locale } from './copy.js';
import { Header } from './Header.js';
import { HeroScene } from './HeroScene.js';
import { Leads } from './Leads.js';
import { Trust } from './Trust.js';
import { Setup } from './Setup.js';
import { Pricing } from './Pricing.js';
import { Faq } from './Faq.js';
import { Closing } from './Closing.js';
import { SITE_URL, jsonLdScript, structuredData } from './structured-data.js';
import base from './landing.module.css';

const HOME: Record<Locale, string> = { en: '/', ms: '/ms' };

export function landingMetadata(locale: Locale): Metadata {
  const copy = COPY[locale];
  const url = `${SITE_URL}${HOME[locale] === '/' ? '' : HOME[locale]}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: {
      canonical: HOME[locale],
      languages: { 'en-MY': '/', 'ms-MY': '/ms', 'x-default': '/' },
    },
    openGraph: {
      type: 'website',
      url,
      siteName: 'Curios',
      title: copy.meta.title,
      description: copy.meta.description,
      locale: copy.meta.ogLocale,
      alternateLocale: locale === 'ms' ? 'en_MY' : 'ms_MY',
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.meta.title,
      description: copy.meta.description,
    },
  };
}

/**
 * The landing page, in either language. Section order follows the owner's
 * objections, not a template: what it is (the pinned hero), the problem it removes
 * (its second caption), what you pay for (leads), "it'll get prices wrong" (trust), "no
 * time to set up" (setup), "is it worth RM39" (pricing), the rest (FAQ).
 *
 * The root layout fixes <html lang="en">, so the Malay page declares its
 * language on its own outermost element; screen readers and browsers honour
 * that, and search engines read the hreflang alternates above.
 */
export function LandingPage({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const other: Locale = locale === 'ms' ? 'en' : 'ms';
  const url = `${SITE_URL}${HOME[locale] === '/' ? '' : HOME[locale]}`;

  return (
    <div className={base.page} data-landing lang={locale}>
      <a href="#main" className={base.skip}>
        {locale === 'ms' ? 'Langkau ke kandungan' : 'Skip to content'}
      </a>
      <Header copy={copy} home={HOME[locale]} otherHome={HOME[other]} />
      <main id="main">
        <HeroScene copy={copy} />
        <Leads copy={copy} />
        <Trust copy={copy} />
        <Setup copy={copy} />
        <Pricing copy={copy} />
        <Faq copy={copy} />
      </main>
      <Closing copy={copy} otherHome={HOME[other]} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(structuredData(copy, url)) }} />
    </div>
  );
}

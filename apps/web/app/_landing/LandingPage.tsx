import type { Metadata } from 'next';
import './landing-tokens.css';
import { COPY, type Locale } from './copy.js';
import { Nav } from './Nav.js';
import { Hero } from './Hero.js';
import { AskStrip } from './AskStrip.js';
import { Loop } from './Loop.js';
import { Who } from './Who.js';
import { How } from './How.js';
import { Business } from './Business.js';
import { Pricing } from './Pricing.js';
import { Faq } from './Faq.js';
import { Closing } from './Closing.js';
import { Footer } from './Footer.js';
import { SITE_URL, jsonLdScript, structuredData } from './structured-data.js';
import styles from './tanya.module.css';

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
 * The landing page, in either language, from the design handoff's TanyaJe
 * board: who can ask what (the hero and the strip under it), who it is for,
 * how it works, what a business gets, what it costs, the questions, then the
 * close.
 *
 * The root layout fixes <html lang="en">, so the Malay page declares its
 * language on its own outermost element; screen readers and browsers honour
 * that, and search engines read the hreflang alternates above.
 */
export function LandingPage({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const url = `${SITE_URL}${HOME[locale] === '/' ? '' : HOME[locale]}`;

  return (
    <div className={styles.page} data-landing lang={locale}>
      <a href="#main" className={styles.skip}>
        {copy.skip}
      </a>
      <Nav copy={copy} home={HOME[locale]} />
      <main id="main">
        <Hero locale={locale} />
        <AskStrip locale={locale} />
        <Loop text={copy.loop} />
        <Who locale={locale} />
        <How locale={locale} />
        <Business locale={locale} />
        <Pricing locale={locale} />
        <Faq copy={copy.faq} />
      </main>
      <Closing locale={locale} />
      <Footer copy={copy} locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(structuredData(copy, url)) }} />
    </div>
  );
}

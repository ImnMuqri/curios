import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ringgit } from '@curios/core/money';
import type { PlanTerms } from '@curios/core/settings';
import { Wordmark } from '../_landing/Wordmark.js';
import {
  CHROME,
  DOCS,
  LEGAL_DOCS,
  LEGAL_PATH,
  SUPPORT_EMAIL,
  UPDATED,
  type Block,
  type LegalDoc,
  type Locale,
} from './content.js';
import styles from './legal.module.css';

/** The landing page in the same language. */
const HOME: Record<Locale, string> = { en: '/', ms: '/ms' };
const OG_LOCALE: Record<Locale, string> = { en: 'en_MY', ms: 'ms_MY' };
const DATE_LOCALE: Record<Locale, string> = { en: 'en-MY', ms: 'ms-MY' };

export function legalMetadata(doc: LegalDoc, locale: Locale): Metadata {
  const { title, description } = DOCS[locale][doc];
  return {
    title: `${title} · Curios`,
    description,
    alternates: {
      canonical: LEGAL_PATH[locale][doc],
      languages: { 'en-MY': LEGAL_PATH.en[doc], 'ms-MY': LEGAL_PATH.ms[doc], 'x-default': LEGAL_PATH.en[doc] },
    },
    openGraph: { type: 'article', siteName: 'Curios', title, description, locale: OG_LOCALE[locale] },
  };
}

/**
 * The Terms, Privacy and Refund pages, in either language. No board draws
 * them (DEVIATIONS 137): the System board's paper and wordmark, with one
 * readable column of text instead of a centred card.
 *
 * `plan` is the prices and free counts in force, read by the page
 * (`getSettings()`), which `{monthly}` and the like are rendered as.
 */
export function LegalPage({ doc, locale, plan }: { doc: LegalDoc; locale: Locale; plan: PlanTerms }) {
  const chrome = CHROME[locale];
  const { title, lede, sections } = DOCS[locale][doc];
  const updated = UPDATED.toLocaleDateString(DATE_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });

  return (
    <div className={styles.legal} lang={locale}>
      <header className={styles.top}>
        <a className={styles.brand} href={HOME[locale]} aria-label={chrome.home}>
          <Wordmark />
        </a>
        <a className={styles.lang} href={LEGAL_PATH[chrome.other.lang][doc]} hrefLang={chrome.other.lang} lang={chrome.other.lang}>
          {chrome.other.name}
        </a>
      </header>

      <main className={styles.main}>
        <nav aria-label={chrome.tabsLabel} className={styles.tabs}>
          {LEGAL_DOCS.map((d) => (
            <a key={d} href={LEGAL_PATH[locale][d]} aria-current={d === doc ? 'page' : undefined}>
              {chrome.tab[d]}
            </a>
          ))}
        </nav>

        <h1 className={styles.h}>{title}</h1>
        <p className={styles.updated}>
          {chrome.updated} <time dateTime={UPDATED.toISOString().slice(0, 10)}>{updated}</time>
        </p>
        <p className={styles.lede}>{rich(lede, locale, plan)}</p>

        {sections.map((section, i) => (
          <section key={section.heading} className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.num} aria-hidden="true">
                {i + 1}
              </span>
              {section.heading}
            </h2>
            {section.body.map((block, j) => (
              <BlockView key={j} block={block} locale={locale} plan={plan} />
            ))}
          </section>
        ))}

        <p className={styles.foot}>{rich(chrome.questions, locale, plan)}</p>
        <a className={styles.back} href={HOME[locale]}>
          {chrome.back}
        </a>
      </main>
    </div>
  );
}

function BlockView({ block, locale, plan }: { block: Block; locale: Locale; plan: PlanTerms }) {
  if (typeof block === 'string') return <p className={styles.p}>{rich(block, locale, plan)}</p>;
  return (
    <ul className={styles.list}>
      {block.list.map((item) => (
        <li key={item}>{rich(item, locale, plan)}</li>
      ))}
    </ul>
  );
}

const TOKEN = /\{(terms|privacy|refunds|email|monthly|annual|leads|orders)\}/;

/**
 * Turns `{privacy}` and the like into links, `{email}` into a mail link, and
 * `{monthly}`, `{annual}`, `{leads}` and `{orders}` into the plan in force.
 */
function rich(text: string, locale: Locale, plan: PlanTerms): ReactNode[] {
  const values: Record<string, string> = {
    monthly: ringgit(plan.prices.MONTHLY),
    annual: ringgit(plan.prices.ANNUAL),
    leads: String(plan.freeLeads),
    orders: String(plan.freeOrders),
  };
  return text.split(TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part in values) return values[part];
    if (part === 'email') {
      return (
        <a key={i} href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
      );
    }
    const doc = part as LegalDoc;
    return (
      <a key={i} href={LEGAL_PATH[locale][doc]}>
        {CHROME[locale].name[doc]}
      </a>
    );
  });
}

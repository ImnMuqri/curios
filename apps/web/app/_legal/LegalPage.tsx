import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ringgit } from '@curios/core/money';
import type { PlanTerms } from '@curios/core/settings';
import { landingCopy } from '../_landing/copy.js';
import { Footer } from '../_landing/Footer.js';
import { SiteNav } from '../_site/SiteNav.js';
import '../_landing/landing-tokens.css';
import { LegalToc } from './LegalToc.js';
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
 * The Terms, Privacy, Refund and Return pages, in either language, from the Site
 * board: the landing's nav and footer, a "Legal" eyebrow over a 56px title, the
 * date and an English | Bahasa Melayu toggle, the lede, the four documents as
 * tabs, then the text beside a sticky table of contents, its sections numbered.
 * The board abbreviates the text; every section is kept. "Questions about this
 * page?" stays at the end of it: a legal page needs a way to write to us.
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
  const items = sections.map((section, i) => ({ id: `${doc}-${i}`, heading: section.heading }));

  return (
    <div className={styles.legal} data-landing data-laptop-scale lang={locale}>
      <SiteNav locale={locale} />

      <main>
        <header className={styles.head}>
          <div className={styles.dots} aria-hidden="true" />
          <div className={styles.headIn}>
            <p className={styles.kick}>{chrome.eyebrow}</p>
            <h1 className={styles.h}>{title}</h1>
            <div className={styles.meta}>
              <span>
                {chrome.updated} <time dateTime={UPDATED.toISOString().slice(0, 10)}>{updated}</time>
              </span>
              <span className={styles.langs} role="group" aria-label={chrome.languages}>
                {(['en', 'ms'] as const).map((l) => (
                  <LangPill key={l} lang={l} href={LEGAL_PATH[l][doc]} name={l === 'en' ? 'English' : 'Bahasa Melayu'} current={l === locale} />
                ))}
              </span>
            </div>
            <p className={styles.lede}>{rich(lede, locale, plan)}</p>
            <nav aria-label={chrome.tabsLabel} className={styles.docs}>
              {LEGAL_DOCS.map((d) => (
                <a key={d} href={LEGAL_PATH[locale][d]} aria-current={d === doc ? 'page' : undefined}>
                  {chrome.tab[d]}
                </a>
              ))}
            </nav>
          </div>
        </header>

        <div className={styles.body}>
          <LegalToc label={chrome.contents} items={items} />
          <div className={styles.text}>
            {sections.map((section, i) => (
              <section key={section.heading} id={items[i]!.id} className={styles.section} aria-labelledby={`${items[i]!.id}-h`}>
                <h2 className={styles.h2} id={`${items[i]!.id}-h`}>
                  <i className={styles.num} aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </i>
                  {section.heading}
                </h2>
                {section.body.map((block, j) => (
                  <BlockView key={j} block={block} locale={locale} plan={plan} />
                ))}
              </section>
            ))}

            <p className={styles.foot}>{rich(chrome.questions, locale, plan)}</p>
          </div>
        </div>
      </main>

      <Footer copy={landingCopy(locale, plan)} locale={locale} sectionsBase={HOME[locale]} note={chrome.runBy} showOperator={false} />
    </div>
  );
}

/** One side of the English | Bahasa Melayu toggle: the language you are reading is a mark, the other a link. */
function LangPill({ lang, href, name, current = false }: { lang: Locale; href: string; name: string; current?: boolean }) {
  if (current) {
    return (
      <span className={`${styles.lang} ${styles.langOn}`} lang={lang} aria-current="true">
        {name}
      </span>
    );
  }
  return (
    <a className={styles.lang} href={href} hrefLang={lang} lang={lang}>
      {name}
    </a>
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

const TOKEN = /\{(terms|privacy|refunds|returns|email|monthly|annual|leads|orders)\}/;

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

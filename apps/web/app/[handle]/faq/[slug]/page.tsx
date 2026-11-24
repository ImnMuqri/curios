import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { serialiseJsonLd } from '@curios/core';
import { getFaqEntry, getFaqRedirect } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../../_system/unavailable.js';
import { PageTheme } from '../../../_bento/BentoPage.js';
import { TopBar } from '../../top-bar.js';
import sheet from '../../sheet.module.css';
import { shopCopy } from '../../shop/copy.js';
import { AskBar } from '../ask-bar.js';
import { faqCopy } from '../faq-copy.js';
import styles from '../faq.module.css';

export const runtime = 'nodejs';
// 60 seconds, not the 24 hours FRONTEND.md's route table first specified. These
// pages carry a customer's own words, and an owner who takes one down must not
// wait a day to see it gone -- that latency was half of the takedown gap
// recorded in devDocs/deferred-findings.md. Both routes are two indexed reads,
// so the cost of re-rendering more often is small and bounded; the alternative,
// calling revalidatePath from the API, needs a shared secret and couples two
// deployables, which is what choosing ISR was meant to avoid.
export const revalidate = 60;

/**
 * None at build time, so `pnpm build` still needs no database. Its presence is what makes the
 * route ISR: without it Next 15 renders a dynamic segment on every request and `revalidate` above
 * does nothing (measured 2026-10-26 on a production build: every view read Postgres). With it, the
 * first visitor to an address renders it and the next 60 seconds of visitors get that HTML.
 */
export function generateStaticParams(): { handle: string; slug: string }[] {
  return [];
}

/** Google's own guidance for a meta description; not a hard technical limit. */
const DESCRIPTION_MAX_CHARS = 155;

/**
 * A meta description that never cuts mid-word, mid-surrogate-pair, or --
 * the case that matters on this product -- mid-price. A hard `.slice(0, 155)`
 * can turn "RM120" into "RM1", and that mangled string is what Google shows
 * as the search snippet. This is one non-negotiable rule (never state a price
 * the owner did not write) failing on the one surface truncation exists to
 * create.
 *
 * `Array.from` iterates by code point, not UTF-16 code unit, so a surrogate
 * pair is counted and cut as one character rather than split in half.
 */
function truncateForDescription(text: string, max = DESCRIPTION_MAX_CHARS): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= max) return text;

  const hardCut = codePoints.slice(0, max).join('');
  const lastSpace = hardCut.lastIndexOf(' ');
  // No space at all (one very long token) falls back to the hard cut rather
  // than returning the whole answer -- still surrogate-safe, just not
  // word-safe, which only matters for text this route never actually sees.
  const wordSafe = lastSpace > 0 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${wordSafe.trimEnd()}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}): Promise<Metadata> {
  const { handle, slug } = await params;
  const entry = await getFaqEntry(handle, slug);
  if (!entry) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : {};
  return {
    title: faqCopy(entry.language).entryTitle(entry.question, entry.displayName),
    // The answer is the description: it is what a searcher wants to see in the
    // result, and it is the owner's own words.
    description: truncateForDescription(entry.answer),
  };
}

export default async function FaqEntryPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const entry = await getFaqEntry(handle, slug);

  if (!entry) {
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
    // A slug retired by a merge or split points at its topic's live page; the
    // permanent redirect carries search ranking over. Every other failure (no
    // such handle, personal or unpublished page, unknown slug, withdrawn
    // answer) is one 404: a visitor needs no distinction.
    const target = await getFaqRedirect(handle, slug);
    if (target) permanentRedirect(`/${handle.toLowerCase()}/faq/${target}`);
    notFound();
  }

  const jsonLd = serialiseJsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer', text: entry.answer },
      },
    ],
  });

  const copy = faqCopy(entry.language);
  const updated = entry.answeredAt ? shopCopy(entry.language).shortDate(entry.answeredAt.toISOString()) : null;

  return (
    <PageTheme theme={entry.theme} className={styles.stage} paintDocument>
      <main className={styles.page}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        <TopBar title={entry.displayName} back={{ href: `/${entry.handle}`, label: copy.backTo(entry.displayName) }} />
        <div className={`${sheet.sheet} ${styles.sheet}`}>
          <p className={styles.kicker}>{copy.kicker(entry.displayName)}</p>
          <h1 className={styles.heading}>{entry.question}</h1>
          <p className={styles.answer}>{entry.answer}</p>
          <p className={styles.by}>{copy.answeredBy(entry.displayName, updated)}</p>
          {/* The board's "More questions": all of them first, then the nearest few (the links search engines follow). */}
          <nav className={styles.more} aria-label={copy.moreQuestions}>
            <b>{copy.moreQuestions}</b>
            <a href={`/${entry.handle}/faq`}>
              {copy.allQuestions}
              <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </a>
            {entry.related.map((other) => (
              <a key={other.slug} href={`/${entry.handle}/faq/${other.slug}`}>
                {other.question}
                <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </a>
            ))}
          </nav>
          <AskBar handle={entry.handle} placeholder={copy.askPlaceholder(entry.displayName)} send={copy.askSend} />
        </div>
      </main>
    </PageTheme>
  );
}

import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { serialiseJsonLd } from '@curios/core';
import { getFaqEntry, getFaqRedirect } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../../_system/unavailable.js';
import { PageTheme } from '../../../_bento/BentoPage.js';
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
    title: `${entry.question} — ${entry.displayName}`,
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

  return (
    <PageTheme theme={entry.theme} className={styles.stage} paintDocument>
      <main className={styles.page}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        <div className={styles.top}>
          <a className={styles.back} href={`/${entry.handle}/faq`} aria-label="All questions">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </a>
          <span className={styles.crumb}>
            <a href={`/${entry.handle}`}>{entry.displayName}</a> / <a href={`/${entry.handle}/faq`}>Questions</a>
          </span>
        </div>
        <h1 className={styles.heading}>{entry.question}</h1>
        <div className={styles.answer}>
          <p>{entry.answer}</p>
          <small className={styles.by}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Answered by {entry.displayName} · asked {entry.askCount} {entry.askCount === 1 ? 'time' : 'times'}
          </small>
        </div>
        <div className={styles.askMore}>
          <span>
            <b>Still wondering?</b>
            <span>Ask {entry.displayName}&rsquo;s page anything.</span>
          </span>
          <a className={styles.lite} href={`/${entry.handle}#ask`}>
            Ask
          </a>
        </div>
        {entry.related.length > 0 ? (
          <>
            <h2 className={styles.also}>People also ask</h2>
            <ul className={styles.list}>
              {entry.related.map((other) => (
                <li key={other.slug}>
                  <a className={styles.question} href={`/${entry.handle}/faq/${other.slug}`}>
                    <b>{other.question}</b>
                    <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </PageTheme>
  );
}

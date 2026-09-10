import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serialiseJsonLd } from '@curios/core';
import { getFaqEntry } from '@curios/db-read';
import styles from '../faq.module.css';

export const runtime = 'nodejs';
export const revalidate = 86400;

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
  if (!entry) return {};
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

  // One null for every failure: no such handle, personal page, unpublished
  // page, unknown slug, withdrawn answer. A visitor needs no distinction.
  if (!entry) notFound();

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
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <p className={styles.shop}>{entry.displayName}</p>
      <h1 className={styles.heading}>{entry.question}</h1>
      <p className={styles.answer}>{entry.answer}</p>
      <a className={styles.back} href={`/${entry.handle}`}>
        Back to {entry.displayName}
      </a>
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serialiseJsonLd } from '@curios/core';
import { getFaqEntry } from '@curios/db-read';
import styles from '../faq.module.css';

export const runtime = 'nodejs';
export const revalidate = 86400;

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
    description: entry.answer.slice(0, 155),
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

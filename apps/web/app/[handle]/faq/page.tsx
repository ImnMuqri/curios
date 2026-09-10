import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serialiseJsonLd } from '@curios/core';
import { getFaqIndex } from '@curios/db-read';
import styles from './faq.module.css';

// Node, not edge: this reads Postgres through the read-only role, like
// /[handle].
export const runtime = 'nodejs';

// FRONTEND.md's "static, revalidate 24h". Deliberately without
// generateStaticParams -- enumerating every qualifying question at build time
// would make `pnpm build` require a live database, which it does not today.
// The first visitor renders; everyone after gets cached HTML.
export const revalidate = 86400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const index = await getFaqIndex(handle);
  if (!index) return {};
  return {
    title: `Questions about ${index.displayName}`,
    description: `What people ask ${index.displayName}, answered by ${index.displayName}.`,
  };
}

export default async function FaqIndexPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const index = await getFaqIndex(handle);

  // An index with no entries is a page with no reason to exist. 404 rather
  // than publish an empty one -- a thin page indexed is worse than no page.
  if (!index || index.entries.length === 0) notFound();

  const jsonLd = serialiseJsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: index.entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        // The index links rather than inlines, so the answer text lives on the
        // entry page. `url` is the honest representation of that.
        url: `/${index.handle}/faq/${entry.slug}`,
      },
    })),
  });

  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <p className={styles.shop}>{index.displayName}</p>
      <h1 className={styles.heading}>What people ask</h1>
      <ul className={styles.list}>
        {index.entries.map((entry) => (
          <li key={entry.slug}>
            <a className={styles.question} href={`/${index.handle}/faq/${entry.slug}`}>
              {entry.question}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

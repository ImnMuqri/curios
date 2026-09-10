import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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

  // No FAQPage JSON-LD here, deliberately. Google's FAQPage requirements make
  // acceptedAnswer.text mandatory, and this page shows questions only -- the
  // answer text lives on the entry page it links to. Structured data must
  // describe content visible on the page it sits on; inlining every answer
  // here just to satisfy the schema would trade invalid markup for deceptive
  // markup. The entry pages, where the answer is actually visible, carry
  // FAQPage -- and a specific question is what should rank there anyway.
  return (
    <main className={styles.page}>
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
      <a className={styles.back} href={`/${index.handle}`}>
        Back to {index.displayName}
      </a>
    </main>
  );
}

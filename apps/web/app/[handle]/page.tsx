import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicPage } from '@curios/db-read';
import { Chip, LinkRow } from '@curios/ui';
import { Ask } from './ask.js';
import styles from './page.module.css';

// Node, not edge: this reads Postgres directly through the read-only role.
export const runtime = 'nodejs';

/**
 * The first metadata in this app, and it exists to honour a promise
 * FRONTEND.md has made since slice 1: personal pages are noindex by default.
 *
 * A privacy decision, not an SEO one. The opt-in toggle belongs in
 * /app/appearance, which does not exist yet -- until it does, personal means
 * not indexed, which is the safe direction to be wrong in.
 *
 * This repeats the `getPublicPage` the render does, the same way every /app
 * page repeats its layout's `resolveOwner`. Deduping is a `cache()` change
 * across every route, not this slice's.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) return {};

  return {
    title: page.displayName,
    description: page.bio ?? undefined,
    ...(page.mode === 'PERSONAL' ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) notFound();

  // Facts written before the question column existed have none. They still
  // render their claim -- the answer is the part a visitor came for -- they
  // just cannot be offered as a question the bar cycles.
  const questions = page.facts
    .map((fact) => fact.question)
    .filter((question): question is string => question !== null);

  // Server-rendered into real DOM. With JavaScript disabled this is still a
  // working link list with readable answers, which is also the SEO artifact.
  return (
    <main className={styles.page}>
      <h1 className={styles.name}>{page.displayName}</h1>
      {page.bio ? <p className={styles.bio}>{page.bio}</p> : null}

      <nav className={styles.links}>
        {page.links.map((link) => (
          <LinkRow key={link.id} href={link.url} label={link.label} />
        ))}
      </nav>

      <section>
        <h2 className={styles.sectionLabel}>What people ask</h2>
        <ul className={styles.facts}>
          {page.facts.map((fact) => (
            <li key={fact.id} className={styles.fact}>
              {fact.question ? <Chip>{fact.question}</Chip> : null}
              <p className={styles.claim}>{fact.claim}</p>
            </li>
          ))}
        </ul>
      </section>

      <Ask
        handle={page.handle}
        questions={questions}
        shopName={page.displayName}
        canCapture={page.mode === 'BUSINESS'}
      />
    </main>
  );
}

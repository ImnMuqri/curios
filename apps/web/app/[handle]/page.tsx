import { notFound } from 'next/navigation';
import { getPublicPage } from '@curios/db-read';
import { Chip, LinkRow } from '@curios/ui';
import { Ask } from './ask.js';
import styles from './page.module.css';

// Node, not edge: this reads Postgres directly through the read-only role.
export const runtime = 'nodejs';

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

      <Ask handle={page.handle} questions={questions} />
    </main>
  );
}

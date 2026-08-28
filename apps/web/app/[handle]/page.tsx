import { notFound } from 'next/navigation';
import { getPublicPage } from '@curios/db-read';
import { AskBar } from './ask-bar.js';

// Node, not edge: this reads Postgres directly through the read-only role.
export const runtime = 'nodejs';

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) notFound();

  // Server-rendered into real DOM. With JavaScript disabled this is still a
  // working link list with readable answers, which is also the SEO artifact.
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 32, margin: '0 0 4px' }}>{page.displayName}</h1>
      {page.bio ? <p style={{ color: 'var(--muted)', marginTop: 0 }}>{page.bio}</p> : null}

      <nav style={{ margin: '24px 0' }}>
        {page.links.map((link) => (
          <a key={link.id} className="link-row" href={link.url}>
            <span>{link.label}</span>
            <span aria-hidden="true">→</span>
          </a>
        ))}
      </nav>

      <section>
        <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.13em', color: 'var(--muted)' }}>
          What people ask
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {page.facts.map((fact) => (
            <li key={fact.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--surface)' }}>
              {fact.claim}
            </li>
          ))}
        </ul>
      </section>

      <AskBar handle={page.handle} questions={page.facts.map((f) => f.claim)} />
    </main>
  );
}

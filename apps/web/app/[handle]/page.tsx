import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canCapture, shouldIndex } from '@curios/core';
import { getFaqIndex, getPublicPage } from '@curios/db-read';
import { BentoPage } from '../_bento/BentoPage.js';
import { avatarUrl } from '../../lib/avatar-url.js';
import { Ask } from './ask.js';
import styles from './page.module.css';

// Node, not edge: this reads Postgres directly through the read-only role.
export const runtime = 'nodejs';

// Declared, not merely observed. This route was already dynamic -- verified
// with `next start` + `curl -D-`: `no-store`, no `x-nextjs-cache`, and a live
// `UPDATE` visible on the very next request -- but it was dynamic by accident
// of using Prisma rather than `fetch`, which nothing enforced. Adding
// `revalidate` for performance, or a Next upgrade changing the default, would
// have frozen `now`, `paidUntil` and `leadsCaptured` and put the capture card
// back on a lapsed page. The endpoint would still refuse it, so the failure is
// the silent one the two-site design exists to prevent: a card that fails on
// submit. Unlike the FAQ routes, which opt into ISR deliberately, this one
// says so out loud.
export const dynamic = 'force-dynamic';

/**
 * The first metadata in this app, and it exists to honour a promise
 * FRONTEND.md has made since slice 1: personal pages are noindex by default.
 *
 * A privacy decision, not an SEO one. The owner opts in from Settings, and
 * `shouldIndex` in `@curios/core` is the one place that decides -- its
 * default is still the safe direction to be wrong in.
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
    // One rule, in @curios/core: every business page, and a personal page only
    // once its owner has opted in. There is no sitemap, so this tag is the
    // whole of the control.
    ...(shouldIndex(page) ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) notFound();

  // Facts now reach a visitor only through the ask bar's cycling questions and
  // the FAQ pages, per slice 13 -- this page renders no fact list of its own.
  const questions = page.facts
    .map((fact) => fact.question)
    .filter((question): question is string => question !== null);

  // One extra small indexed read, deliberate: this page is otherwise the only
  // route in the product that never points at /[handle]/faq, which orphans it
  // for both visitors and crawlers. The index itself 404s when a page has no
  // qualifying questions, so linking there unconditionally would sometimes
  // link to a 404 -- worse than not linking. `limit: 1` because only whether
  // any entry exists matters here; skipped entirely for a personal page,
  // which the index gates on anyway.
  const hasFaq =
    page.mode === 'BUSINESS'
      ? ((await getFaqIndex(page.handle, { limit: 1 }))?.entries.length ?? 0) > 0
      : false;

  // Server-rendered into real DOM: with JavaScript disabled the tiles are
  // still a working link list, which is also the SEO artifact.
  return (
    <main>
      <BentoPage
        displayName={page.displayName}
        handle={page.handle}
        bio={page.bio}
        avatarUrl={avatarUrl(page.avatarKey)}
        links={page.links}
        style={page.style}
        accentColor={page.accentColor}
        headingFont={page.headingFont}
      >
        {/* A sibling of the ask bar, never a wrapper: the bar is position:
            sticky, and a wrapper would become its containing block and stop
            it sticking. The prompt scrolls away; the bar stays. */}
        <p className={styles.askPrompt}>What do you want to know?</p>
        <Ask
          handle={page.handle}
          questions={questions}
          shopName={page.displayName}
          canCapture={canCapture({
            mode: page.mode,
            paidUntil: page.paidUntil,
            leadsCaptured: page.leadsCaptured,
            now: new Date(),
          })}
        />
        {hasFaq ? (
          <a className={styles.faqLink} href={`/${page.handle}/faq`}>
            See every question we&apos;ve answered
          </a>
        ) : null}
      </BentoPage>
    </main>
  );
}

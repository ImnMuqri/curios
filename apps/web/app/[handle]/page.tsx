import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canCapture, shouldIndex } from '@curios/core';
import { getFaqIndex, getPublicPage } from '@curios/db-read';
import { BentoPage, FAQ_SHOWN } from '../_bento/BentoPage.js';
import { avatarUrl, coverUrl } from '../../lib/avatar-url.js';
import { Ask } from './ask.js';
import { shopCopy } from './shop/copy.js';

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

  // The FAQ's most asked few, opened in place under the links ("People often
  // ask"), and the way into /[handle]/faq -- without it this page is the only
  // route in the product that never points there, which orphans the index
  // for visitors and crawlers alike. Skipped for a personal page, which the
  // index gates on anyway.
  const faq = page.mode === 'BUSINESS' ? await getFaqIndex(page.handle, { limit: FAQ_SHOWN }) : null;

  const copy = shopCopy(page.language);
  const shop = page.shop
    ? { position: page.shop.position, size: page.shop.size, label: copy.visit, caption: copy.itemCount(page.shop.itemCount), photoUrl: avatarUrl(page.shop.photoKey) }
    : null;

  // Server-rendered into real DOM: with JavaScript disabled the links are
  // still a working link list, which is also the SEO artifact.
  return (
    <main>
      <BentoPage
        displayName={page.displayName}
        handle={page.handle}
        bio={page.bio}
        // BentoPage's own header is the only one that shows this now --
        // ChatMode stopped rendering its own picture once the in-place
        // rework removed its duplicate header, which left Ask (below) with
        // no remaining use for it.
        avatarUrl={avatarUrl(page.avatarKey)}
        links={page.links}
        shop={shop}
        style={page.style}
        accentColor={page.accentColor}
        headingFont={page.headingFont}
        background={page.background}
        backgroundColor={page.backgroundColor}
        coverUrl={coverUrl(page.coverKey)}
        language={page.language}
        faq={faq}
        stage
      >
        {/* The "What do you want to know?" prompt now lives inside Ask
            (ask.tsx) -- it doubles as chat mode's own empty-state greeting,
            which needs to react to client state (whether a turn exists yet)
            that page.tsx, a server component, cannot hold. */}
        <Ask
          handle={page.handle}
          questions={questions}
          displayName={page.displayName}
          canCapture={canCapture({
            mode: page.mode,
            paidUntil: page.paidUntil,
            leadsCaptured: page.leadsCaptured,
            now: new Date(),
          })}
          faqTotal={faq?.total ?? 0}
        />
      </BentoPage>
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canCapture, shouldIndex } from '@curios/core';
import { getFaqIndex, getPublicPage, getSettings } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../_system/unavailable.js';
import { BentoPage, FAQ_SHOWN } from '../_bento/BentoPage.js';
import { avatarUrl, coverUrl } from '../../lib/avatar-url.js';
import { Ask } from './ask.js';
import { shopCopy } from './shop/copy.js';
import { shopPillCaption } from './shop/pill.js';
import { BasketBar } from './shop/basket-bar.js';
import { whatsappNumber } from './shop/basket.js';

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
  if (!page) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : {};

  return {
    title: page.displayName,
    // Never left empty: a page without one would show search results no snippet, or another page's.
    description: page.bio ?? `${page.displayName} on Curios. Ask anything, or find their links.`,
    // One rule, in @curios/core: every business page, and a personal page only
    // once its owner has opted in. There is no sitemap, so this tag is the
    // whole of the control.
    ...(shouldIndex(page) ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) {
    // Suspended by the Curios team: the same address says so, rather than 404.
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
    notFound();
  }

  // The trial is the admin's free leads, as the API's capture gate counts it.
  const { freeLeads } = await getSettings();

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
  // Open but empty (every item off): no pill and no basket, as the board gates both on having items.
  const ordering = page.shop && page.shop.itemCount > 0 ? page.shopOrdering : null;
  const shop =
    page.shop && ordering
      ? {
          label: copy.shop,
          caption: shopPillCaption(ordering, page.shop.itemCount, copy, new Date()),
          photos: page.shop.photos.map((photo) => ({ name: photo.name, url: avatarUrl(photo.photoKey) })),
        }
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
        socials={page.socials}
        faq={faq}
        basketBar={
          ordering ? (
            <BasketBar
              handle={page.handle}
              displayName={page.displayName}
              language={page.language}
              items={ordering.items}
              canTakeOrders={ordering.canTakeOrders}
              whatsapp={whatsappNumber(page.links)}
            />
          ) : null
        }
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
          }, freeLeads)}
          faqTotal={faq?.total ?? 0}
          language={page.language}
        />
      </BentoPage>
    </main>
  );
}

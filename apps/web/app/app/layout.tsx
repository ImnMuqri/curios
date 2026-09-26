import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
// The barrel here, unlike middleware.ts. This file runs on Node, so the
// barrel's transitive node:crypto import is fine. The split between the two
// is deliberate -- see the comment in middleware.ts.
import { SESSION_COOKIE } from '@curios/core';
import { countPendingFacts, getOwnerPage } from '@curios/db-read';
import { Shell } from '@curios/ui';
import { AppFrame } from './app-frame.js';
import { resolveOwner } from './session.js';

/**
 * The second of the three session layers, and the first that proves anything.
 *
 * Middleware already redirected anyone with no cookie at all. What reaches
 * here is a cookie that exists and may still be expired, revoked or forged,
 * and this is where the database is asked.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const owner = await resolveOwner(value);

  if (!owner) redirect('/signin');

  // The frame is gated on having a page, not on the route, and the two are
  // not interchangeable. Three of the four screens are unreachable without a
  // page -- Review redirects back to onboarding, Questions and Leads scope on
  // `page: { accountId }` and match nothing -- so offering them to an owner
  // mid-claim is worse than offering nothing. But onboarding is not a
  // one-time screen either: it renders `<Ingest>` once a page exists, so
  // mounting the frame on a route group that excludes onboarding would strand
  // an owner who came back to add sources. Gating on the page is the only
  // form that gets both right.
  //
  // This repeats the `getOwnerPage` the child page will run for itself, the
  // same way the child pages repeat this layout's `resolveOwner`. Deduping
  // either one is a `cache()` change across every screen, not this fix.
  const page = await getOwnerPage(owner.accountId);

  // No page yet: onboarding, full width, no frame -- the modules would all be
  // unreachable (the reason the old nav was gated on the page, kept).
  if (!page) return <Shell>{children}</Shell>;

  const pendingReview = await countPendingFacts(owner.accountId);
  return (
    <AppFrame displayName={page.displayName} handle={page.handle} pendingReview={pendingReview}>
      {children}
    </AppFrame>
  );
}

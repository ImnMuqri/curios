import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
// The barrel here, unlike middleware.ts. This file runs on Node, so the
// barrel's transitive node:crypto import is fine. The split between the two
// is deliberate -- see the comment in middleware.ts.
import { orderState, planState, SESSION_COOKIE } from '@curios/core';
import { countNavBadges, getConversationUsage, getOwnerPage } from '@curios/db-read';
import { avatarUrl } from '../../lib/avatar-url.js';
import { AppFrame } from './app-frame.js';
import { alertsFor, billingNeedsYou } from './alerts.js';
import { planLabel } from './plan-label.js';
import { resolveOwner } from './session.js';
import { parseTheme, THEME_COOKIE } from './theme.js';

/**
 * The second of the three session layers, and the first that proves anything.
 *
 * Middleware already redirected anyone with no cookie at all. What reaches
 * here is a cookie that exists and may still be expired, revoked or forged,
 * and this is where the database is asked.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
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
  // Onboarding brings its own frame (AuthShell) before a page exists.
  // Through AppFrame all the same (bare), so the tree has one shape either
  // side of claiming: onboarding claims the page part way through and must
  // not be remounted when the server side re-reads.
  if (!page) {
    return (
      <AppFrame bare displayName="" avatarUrl={null} planLabel="" badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL">
        {children}
      </AppFrame>
    );
  }

  const now = new Date();
  const [badges, usage] = await Promise.all([countNavBadges(owner.accountId), getConversationUsage(page.id, now)]);
  // The stop states (trial, limit, plan ended), decided once here for every
  // screen; each screen's header shows the one that is about it.
  const plan = planState({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now });
  // The shop's own count, by the one rule the shop and the API use too.
  const orders = {
    state: orderState({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now }),
    storeEnabled: page.storeEnabled,
    chipRefused: page.chipRefused,
    payByQr: page.payByQr,
  };
  return (
    <AppFrame
      displayName={page.displayName}
      avatarUrl={avatarUrl(page.avatarKey)}
      planLabel={planLabel({ ...page, now })}
      badges={badges}
      mode={page.mode}
      alerts={alertsFor({ plan, usage, now, orders, ...(page.suspendedAt ? { suspension: { reason: page.suspendReason } } : {}) })}
      billingDot={billingNeedsYou(plan, orders)}
      theme={parseTheme(jar.get(THEME_COOKIE)?.value)}
    >
      {children}
    </AppFrame>
  );
}

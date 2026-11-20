import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEAD_RETENTION_MONTHS, SESSION_COOKIE } from '@curios/core';
import { getLeadStats, getLeadsPage, getMyCurios, getOwnerPage } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { Leads } from './leads-screen.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

/**
 * The number, the conversation behind it, and what to do about it.
 *
 * `getLeadsPage` reads this owner's leads inside the query, newest first: every NEW lead (the card, the
 * chip and the sidebar badge count them all, so none may fall off the list) and the newest fifty of
 * the rest. Nothing here re-filters or re-sorts, on purpose: a second opinion about ordering on the
 * read side is exactly how "newest first" quietly stops being true. The figures are counted in the
 * database, not from the leads in hand.
 *
 * `?before=<lead id>` is the next fifty down (leads past New), from "Older leads".
 */
const LEADS_PER_PAGE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ before?: string | string[] }> }) {
  const query = await searchParams;
  const before = typeof query.before === 'string' && query.before ? query.before : undefined;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // One moment for the whole screen, so "25 min ago" and the week read the
  // same on the server and in the browser.
  const now = new Date();
  // The page first, and its mode and handle: a personal page never has leads, so nothing more is read for it.
  const [page, look] = await Promise.all([getOwnerPage(owner.accountId), getMyCurios(owner.accountId)]);
  if (!page || !look) redirect('/app/onboarding');

  if (page.mode === 'PERSONAL') {
    // A personal page never offers the capture card, so there will never be
    // a list here. Say why, and where that changes.
    return (
      <>
        <PageHead kicker="Inbox" title="Leads" summary="People your page couldn’t answer, with what they asked." />
        <div className={panel.body}>
          <Callout tone="info">
            Personal pages don&apos;t collect phone numbers. Visitors can still chat with your page. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }

  // What the free trial means for capture is the frame's banner (alerts.ts), shown under this screen's header.
  const [read, stats] = await Promise.all([getLeadsPage(owner.accountId, { perPage: LEADS_PER_PAGE, before }), getLeadStats(owner.accountId, now)]);
  // A cursor that pages nothing (its lead deleted, past New, or never this owner's) is the first page again.
  if (!read) redirect('/app/leads');
  // An enquiry's item photo goes to the browser as a URL; storage's base is read here, on the server.
  const shown = read.leads.map((lead) => ({ ...lead, itemPhotoUrl: avatarUrl(lead.enquiry?.item?.photoKey ?? null) }));
  const paging = { older: read.older, paged: before !== undefined };

  // Keyed by the cursor: "Older leads" is a client-side navigation, and each page of leads starts
  // fresh (no filter, its first lead open), as it did when every page was a full load.
  return (
    <Leads
      key={before ?? ''}
      leads={shown}
      paging={paging}
      stats={stats}
      displayName={page.displayName}
      language={look.language}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
      now={now.toISOString()}
      keptMonths={LEAD_RETENTION_MONTHS}
    />
  );
}

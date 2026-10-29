import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEAD_RETENTION_MONTHS, SESSION_COOKIE } from '@curios/core';
import { getLeadStats, getLeads, getMyCurios, getOwnerPage } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { Leads } from './leads-screen.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

/**
 * The number, the conversation behind it, and what to do about it.
 *
 * `getLeads` clamps at 50 newest-first and already scopes to this owner
 * inside the query -- see `packages/db-read/src/leads.query.ts`. Nothing
 * here re-filters or re-sorts, on purpose: a second opinion about ordering
 * on the read side is exactly how "newest first" quietly stops being true.
 * The figures are counted in the database, not from those fifty.
 *
 * `?before=<lead id>` is the next fifty down, from "Older leads". One more
 * than a page is read, only to know whether to offer that link.
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
  // The page as well as the leads: its mode, handle and look. What the free
  // trial means for capture is the frame's banner (alerts.ts), shown under
  // this screen's header.
  const [leads, stats, page, look] = await Promise.all([
    getLeads(owner.accountId, { limit: LEADS_PER_PAGE + 1, before }),
    getLeadStats(owner.accountId, now),
    getOwnerPage(owner.accountId),
    getMyCurios(owner.accountId),
  ]);
  if (!page || !look) redirect('/app/onboarding');
  // A cursor that pages nothing (its lead deleted, or never this owner's) is the first page again.
  if (before && leads.length === 0) redirect('/app/leads');
  const shown = leads.slice(0, LEADS_PER_PAGE);
  const paging = { older: leads.length > LEADS_PER_PAGE ? (shown.at(-1)?.id ?? null) : null, paged: before !== undefined };

  if (page.mode === 'PERSONAL') {
    // A personal page never offers the capture card, so there will never be
    // a list here. Say why, and where that changes.
    return (
      <>
        <PageHead title="Leads" summary={`Numbers visitors left in the chat · kept for ${LEAD_RETENTION_MONTHS} months`} />
        <div className={panel.body}>
          <Callout tone="info">
            Personal pages don&apos;t collect phone numbers. Visitors can still chat with your page. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }


  // Keyed by the cursor: "Older leads" is a client-side navigation, and each page of leads starts
  // fresh (no filter, its first lead open), as it did when every page was a full load.
  return (
    <Leads
      key={before ?? ''}
      leads={shown}
      paging={paging}
      stats={stats}
      handle={page.handle}
      displayName={page.displayName}
      language={look.language}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
      look={{ accentColor: look.accentColor, headingFont: look.headingFont, background: look.background, backgroundColor: look.backgroundColor }}
      now={now.toISOString()}
      keptMonths={LEAD_RETENTION_MONTHS}
    />
  );
}

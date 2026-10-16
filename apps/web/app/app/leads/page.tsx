import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { planState, SESSION_COOKIE } from '@curios/core';
import { getLeadStats, getLeads, getMyCurios, getOwnerPage } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { Leads } from './leads-screen.js';
import { TrialNotice, trialNotice } from './trial-notice.js';
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
 */
export default async function LeadsPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // One moment for the whole screen, so "25 min ago" and the week read the
  // same on the server and in the browser.
  const now = new Date();
  // The page as well as the leads, because this screen has to explain an
  // absence as well as show a list. An owner whose trial is spent sees the
  // capture card disappear from their public page, and without the notice
  // the only signal is that leads stopped arriving -- which reads as the
  // product being broken.
  const [leads, stats, page, look] = await Promise.all([
    getLeads(owner.accountId),
    getLeadStats(owner.accountId, now),
    getOwnerPage(owner.accountId),
    getMyCurios(owner.accountId),
  ]);
  if (!page || !look) redirect('/app/onboarding');

  if (page.mode === 'PERSONAL') {
    // A personal page never offers the capture card, so there will never be
    // a list here. Say why, and where that changes.
    return (
      <>
        <PageHead title="Leads" note="Numbers visitors left in the chat" />
        <div className={panel.body}>
          <Callout tone="info">
            Personal pages don&apos;t collect phone numbers. Visitors can still chat with your page. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }

  const plan = planState({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now });

  return (
    <Leads
      leads={leads}
      stats={stats}
      handle={page.handle}
      displayName={page.displayName}
      language={look.language}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
      look={{ accentColor: look.accentColor, headingFont: look.headingFont, background: look.background, backgroundColor: look.backgroundColor }}
      now={now.toISOString()}
      notice={trialNotice(plan) ? <TrialNotice state={plan} /> : null}
    />
  );
}

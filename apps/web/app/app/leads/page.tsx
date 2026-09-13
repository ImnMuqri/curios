import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { planState, SESSION_COOKIE } from '@curios/core';
import { getLeads, getOwnerPage } from '@curios/db-read';
import { Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { Leads } from './lead-list.js';
import { TrialNotice } from './trial-notice.js';

/**
 * The number, the conversation behind it, and one way to get rid of either.
 *
 * `getLeads` clamps at 50 newest-first and already scopes to this owner
 * inside the query -- see `packages/db-read/src/leads.query.ts`. Nothing
 * here re-filters or re-sorts, on purpose: a second opinion about ordering
 * on the read side is exactly how "newest first" quietly stops being true.
 */
export default async function LeadsPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // Both, because this screen has to explain an absence as well as show a
  // list. An owner whose trial is spent sees the capture card disappear from
  // their public page, and without this the only signal is that leads stopped
  // arriving -- which reads as the product being broken.
  const [leads, page] = await Promise.all([getLeads(owner.accountId), getOwnerPage(owner.accountId)]);

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The delete handler lives inside `Leads`, a client component
  // -- a Server Component may not pass a function here, and doing so is a
  // 500 at request time that no gate catches.
  return (
    <Shell title="Leads">
      {page ? (
        <TrialNotice
          state={planState({
            mode: page.mode,
            paidUntil: page.paidUntil,
            leadsCaptured: page.leadsCaptured,
            now: new Date(),
          })}
        />
      ) : null}
      <Leads leads={leads} />
    </Shell>
  );
}

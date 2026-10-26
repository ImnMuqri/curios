import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PASTED_TEXT_MAX, SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getReviewQueue, getSettings } from '@curios/db-read';

import { resolveOwner } from '../session.js';
import { ringgit } from '../billing/billing-copy.js';
import { Onboarding } from './onboarding.js';

/**
 * Onboarding, from the design handoff's Onboarding board: claim the address,
 * say what the page is for, give it something to read, watch it read. Full
 * screen (the frame steps aside here). An owner who already has a page starts
 * at the third step, to add a source.
 *
 * The facts waiting in Review cross as props, so when a read finishes and the
 * flow asks the server to re-read, the facts it just found arrive here.
 */
export default async function OnboardingPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  const facts = page ? await getReviewQueue(owner.accountId, { limit: 50 }) : [];
  // The price and free leads in force, as Billing and the landing page quote them.
  const { prices, freeLeads } = await getSettings();

  return (
    <Onboarding
      page={page ? { id: page.id, handle: page.handle, displayName: page.displayName, mode: page.mode } : null}
      facts={facts.map((fact) => ({ id: fact.id, category: fact.category, claim: fact.claim, question: fact.question }))}
      monthlyPrice={ringgit(prices.MONTHLY)}
      freeLeads={freeLeads}
      pastedTextMax={PASTED_TEXT_MAX}
    />
  );
}

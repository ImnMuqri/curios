import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PASTED_TEXT_MAX, PLAN_PRICES_CENTS, SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { ringgit } from '../billing/billing-copy.js';
import { Claim } from './claim-form.js';
import { Ingest } from './ingest-form.js';

export default async function OnboardingPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);

  // Plain values across the boundary. The price and the cap come from the
  // constants here, on the server, because the two client components may not
  // import the core barrel.
  return page ? (
    <Ingest pageId={page.id} mode={page.mode} pastedTextMax={PASTED_TEXT_MAX} />
  ) : (
    <Claim monthlyPrice={ringgit(PLAN_PRICES_CENTS.MONTHLY)} />
  );
}

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLAN_PRICES_CENTS, planState, SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { Callout, Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { paymentBanner, planSummary, ringgit } from './billing-copy.js';
import { PayButtons } from './pay-buttons.js';

/**
 * Plan 1's billing screen: where the page's plan stands, the two ways to pay, and what
 * happened on the way back from Billplz. Usage against the cap, payment history and the
 * trial reset are plan 2.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited, as in settings/page.tsx.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const state = planState({
    mode: page.mode,
    paidUntil: page.paidUntil,
    leadsCaptured: page.leadsCaptured,
    now: new Date(),
  });
  const banner = paymentBanner(params.payment);

  return (
    <Shell title="Billing">
      {banner ? <Callout tone={banner.tone}>{banner.text}</Callout> : null}
      <p>{planSummary(state)}</p>
      {state.kind === 'personal' ? null : (
        <PayButtons
          options={[
            { plan: 'MONTHLY', label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month` },
            { plan: 'ANNUAL', label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year` },
          ]}
        />
      )}
    </Shell>
  );
}

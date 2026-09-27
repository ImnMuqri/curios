import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLAN_PRICES_CENTS, planState, SESSION_COOKIE } from '@curios/core';
import { getConversationUsage, getOwnerPage, getRecentPayments } from '@curios/db-read';
import { Callout, Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { paymentBanner, paymentLine, planSummary, ringgit, usageSummary } from './billing-copy.js';
import { PayButtons } from './pay-buttons.js';
import { ResetTrial } from './reset-button.js';
import { UpgradeToBusiness } from './upgrade-button.js';

/**
 * Where the plan stands, what the month has used, what has been paid, and the
 * two things an owner can do about any of it: pay, or -- once, and only for a
 * page that never paid -- take back a trial they spent testing their own page.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited, as in
 * settings/page.tsx.
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

  const now = new Date();
  const state = planState({
    mode: page.mode,
    paidUntil: page.paidUntil,
    leadsCaptured: page.leadsCaptured,
    now,
  });
  const banner = paymentBanner(params.payment);

  // A personal page pays nothing and is capped like any other, but has no
  // billing story to tell -- so it is asked for neither number.
  const usage = state.kind === 'personal' ? null : await getConversationUsage(page.id, now);
  const payments = state.kind === 'personal' ? [] : await getRecentPayments(page.id);

  // Exactly the conditions the API enforces (billing.service.ts, resetTrial).
  // A button that leads to a 409 is worse than no button.
  const canReset =
    page.mode === 'BUSINESS' &&
    page.paidUntil === null &&
    page.trialResetAt === null &&
    page.leadsCaptured >= 1;

  return (
    <Shell as="div" title="Billing">
      {banner ? <Callout tone={banner.tone}>{banner.text}</Callout> : null}
      <p>{planSummary(state)}</p>
      {usage ? <p>{usageSummary(usage)}</p> : null}
      {canReset ? (
        <section>
          <h2>Spent your trial testing your own page?</h2>
          <p>
            Every lead counts, including the ones you captured yourself. You can put the counter
            back to zero once, and only while the page has never paid.
          </p>
          <ResetTrial />
        </section>
      ) : null}
      {state.kind === 'personal' ? (
        <section>
          <h2>Selling something?</h2>
          <p>
            A business page can take customers' phone numbers: three free leads, then{' '}
            {ringgit(PLAN_PRICES_CENTS.MONTHLY)} a month. Questions asked three or more times get
            their own FAQ pages, and the page appears in search results.
          </p>
          <UpgradeToBusiness />
        </section>
      ) : (
        <PayButtons
          options={[
            { plan: 'MONTHLY', label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month` },
            { plan: 'ANNUAL', label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year` },
          ]}
        />
      )}
      {payments.length > 0 ? (
        <section>
          <h2>Recent payments</h2>
          <ul>
            {payments.map((payment) => (
              <li key={payment.id}>{paymentLine(payment)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}

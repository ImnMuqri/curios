import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FREE_LEADS, PLAN_PRICES_CENTS, planState, SESSION_COOKIE } from '@curios/core';
import { getConversationUsage, getOwnerPage, getRecentPayments } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { COPY } from '../../_landing/copy.js';
import { paymentBanner, paymentParts, planBadge, planSummary, ringgit, usageSummary } from './billing-copy.js';
import { PayButtons } from './pay-buttons.js';
import { ResetTrial } from './reset-button.js';
import { UpgradeToBusiness } from './upgrade-button.js';
import panel from '../panel.module.css';
import styles from './billing.module.css';
import { PageHead } from '../_ui/page-head.js';

/** A thing used out of a limit, as a bar: biru for what is routine, kuning when it is leads (money). */
function Meter({ label, used, of, tone, children }: { label: string; used: number; of: number; tone: 'biru' | 'kuning'; children: string }) {
  const share = of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0;
  return (
    <div className={styles.meter} data-tone={tone}>
      <p className={styles.meterLabel}>
        {label}
        <span>
          {used} / {of}
        </span>
      </p>
      <div className={styles.bar} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={Math.min(used, of)}>
        <span style={{ width: `${share}%` }} />
      </div>
      <p className={styles.meterText}>{children}</p>
    </div>
  );
}

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
  const badge = planBadge(state);

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
    <>
      <PageHead title="Billing" note="Your plan, what this month has used, and what you have paid" />
      <div className={panel.body}>
        {banner ? <Callout tone={banner.tone}>{banner.text}</Callout> : null}
        <div className={panel.stack}>
          <section className={`${panel.panel} ${styles.hero}`} aria-labelledby="plan-title">
            <div className={styles.heroMain}>
              <h2 id="plan-title" className={styles.kicker}>
                Your plan <span className={styles.badge} data-tone={badge.tone}>{badge.text}</span>
              </h2>
              <p className={styles.summary}>{planSummary(state)}</p>
            </div>
            {state.kind === 'trial' || state.kind === 'trialSpent' || usage ? (
              <div className={styles.meters}>
                {state.kind === 'trial' || state.kind === 'trialSpent' ? (
                  <Meter label="Free leads" used={state.kind === 'trial' ? state.used : FREE_LEADS} of={FREE_LEADS} tone="kuning">
                    {state.kind === 'trial' ? `${state.remaining} left before the capture card needs a plan.` : 'All used. Pay to keep taking numbers.'}
                  </Meter>
                ) : null}
                {usage ? (
                  <Meter label="Conversations this month" used={usage.used} of={usage.cap} tone="biru">
                    {usageSummary(usage)}
                  </Meter>
                ) : null}
              </div>
            ) : null}
          </section>

          {state.kind === 'personal' ? null : (
            <section className={panel.panel} aria-labelledby="pay-title">
              <h2 id="pay-title" className={panel.panelTitle}>
                {state.kind === 'paid' ? 'Add more time' : 'Choose a plan'}
              </h2>
              <p className={panel.text}>
                {state.kind === 'paid'
                  ? 'Paying now adds to the time you already have.'
                  : 'Business keeps the capture card on your page, so customers can leave their number.'}
              </p>
              <PayButtons
                options={[
                  {
                    plan: 'MONTHLY',
                    label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month`,
                    name: 'Monthly',
                    price: ringgit(PLAN_PRICES_CENTS.MONTHLY),
                    per: 'a month',
                    note: 'Pay again when you want another month.',
                  },
                  {
                    plan: 'ANNUAL',
                    label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year`,
                    name: 'Yearly',
                    price: ringgit(PLAN_PRICES_CENTS.ANNUAL),
                    per: 'a year',
                    note: 'Two months free, paid once a year.',
                    featured: true,
                  },
                ]}
              />
              <ul className={styles.points}>
                {COPY.en.pricing.business.pointsToday.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <p className={styles.fine}>{COPY.en.pricing.payment}</p>
            </section>
          )}
          {canReset ? (
            <section className={panel.panel}>
              <h2 className={panel.panelTitle}>Spent your trial testing your own page?</h2>
              <p className={panel.text}>
                Every lead counts, including the ones you captured yourself. You can put the counter
                back to zero once, and only while the page has never paid.
              </p>
              <ResetTrial />
            </section>
          ) : null}
          {state.kind === 'personal' ? (
            <section className={`${panel.panel} ${styles.upgrade}`}>
              <h2 className={panel.panelTitle}>Selling something?</h2>
              <p className={panel.text}>
                A business page can take customers' phone numbers: three free leads, then{' '}
                {ringgit(PLAN_PRICES_CENTS.MONTHLY)} a month. Questions asked three or more times get
                their own FAQ pages, and the page appears in search results.
              </p>
              <UpgradeToBusiness />
            </section>
          ) : null}
          {payments.length > 0 ? (
            <section className={panel.panel}>
              <h2 className={panel.panelTitle}>Recent payments</h2>
              <ul className={styles.payments}>
                {payments.map((payment) => {
                  const row = paymentParts(payment);
                  return (
                    <li key={payment.id}>
                      <span className={styles.payDate}>{row.date}</span>
                      <span className={styles.payWhat}>
                        {row.what}
                        {row.until ? <small>Covers you until {row.until}</small> : null}
                      </span>
                      <span className={styles.payStatus} data-paid={row.paid}>
                        {row.paid ? 'Paid' : 'Not completed'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

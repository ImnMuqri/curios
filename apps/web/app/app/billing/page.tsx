import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  extendPaidUntil,
  FREE_LEADS,
  FREE_ORDERS,
  orderState,
  PLAN_PRICES_CENTS,
  planState,
  SESSION_COOKIE,
  type BillingPlan,
  type OrderState,
  type PlanState,
} from '@curios/core';
import { countLeadsThisMonth, countOrdersThisMonth, getConversationUsage, getOwnerPage, getRecentPayments, getSignInMethods } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { daysLeft, paymentBanner, paymentParts, planBadge, planSummary, ringgit, shortDate, shortDateFrom, usageResets } from './billing-copy.js';
import { PayButtons, type PayOption } from './pay-buttons.js';
import { ResetTrial } from './reset-button.js';
import { UpgradeToBusiness } from './upgrade-button.js';
import styles from './billing.module.css';
import { PageHead } from '../_ui/page-head.js';
import { CountUp } from '../_ui/count-up.js';
import { PaidToast } from './paid-toast.js';
import { NEAR_SHARE } from '../alerts.js';

/** What Business includes, as the Billing board lists it. */
const INCLUDED = ['Numbers from the chat', 'Your own shop', 'FAQ pages', 'Found in search'];

const PLANS: { plan: BillingPlan; name: string; note: string; period: string; unit: string; save?: string }[] = [
  { plan: 'MONTHLY', name: 'Monthly', note: 'One month at a time', period: 'a month', unit: 'month' },
  { plan: 'ANNUAL', name: 'Yearly', note: 'Paid once a year', period: 'a year', unit: 'year', save: '2 months free' },
];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The big number on the plan card, the words beside it, and the sentence under it. */
function planHead(state: PlanState, now: Date): { big: number; unit: string; sub: ReactNode } | null {
  switch (state.kind) {
    case 'personal':
      return null;
    case 'paid': {
      const days = daysLeft(state.paidUntil, now);
      return {
        big: days,
        unit: plural(days, 'day left', 'days left'),
        sub: (
          <>
            Paid until <b>{shortDate(state.paidUntil, true)}</b>. No auto-renew, so nothing is charged without you.
          </>
        ),
      };
    }
    case 'trial':
      return {
        big: state.remaining,
        unit: plural(state.remaining, 'free lead left', 'free leads left'),
        sub: state.lapsedOn
          ? planSummary(state)
          : `Answering is free forever. Your first ${FREE_LEADS} numbers are free too. After that, the capture card on your page needs a plan.`,
      };
    case 'trialSpent':
      return { big: 0, unit: 'free leads left', sub: planSummary(state) };
    case 'lapsed':
      return { big: 0, unit: 'days left', sub: planSummary(state) };
  }
}

/**
 * The Orders meter's line. Paid is the board's; the board draws no trial, so a
 * trial counts the free orders the way the plan card counts the free leads, and
 * a spent one says the shop has stopped, as Store's "Open for orders" does.
 */
function ordersNote(state: OrderState): { paid: boolean; note: string } {
  const stopped = 'Your shop takes no orders until you pay.';
  switch (state.kind) {
    case 'paid':
      return { paid: true, note: 'Take as many as you get.' };
    case 'trial':
      return { paid: false, note: `${state.used} of ${FREE_ORDERS} free orders used` };
    case 'trialSpent':
      return { paid: false, note: `${FREE_ORDERS} of ${FREE_ORDERS} free orders used. ${stopped}` };
    case 'lapsed':
      return { paid: false, note: `Your plan ended on ${shortDate(state.paidUntil, true)}. ${stopped}` };
    case 'personal':
      return { paid: false, note: '' };
  }
}

/** A thing used this month, as the board's meter: the count, what it is out of, a bar, a line. */
function Meter({ label, used, of, share, tone, children }: { label: string; used: number; of: string; share: number; tone: 'biru' | 'kuning' | 'merah' | 'hijau' | 'rose'; children: ReactNode }) {
  return (
    <div className={styles.meter}>
      <p className={styles.mh}>
        <span>{label}</span>
        <span>
          <b>
            <CountUp value={used} />
          </b>{' '}
          {of}
        </span>
      </p>
      <div className={styles.mbar} data-tone={tone} aria-hidden="true">
        <i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
      </div>
      <small>{children}</small>
    </div>
  );
}

/**
 * Where the plan stands, what the month has used, and what has been paid, from
 * the design handoff's Billing board; and the things an owner can do about it:
 * pay for more time, or -- once, and only for a page that never paid -- take
 * back a trial they spent testing their own page. A personal page has nothing
 * to pay for, and is offered the switch to business instead.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited.
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
  const state = planState({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now });
  // Back from Billplz: a confirmed payment is the board's toast; one Billplz
  // called paid before its callback reached us still reads as confirming.
  const paidNow = params.payment === 'paid' && state.kind === 'paid';
  const banner = paidNow ? null : paymentBanner(params.payment === 'paid' ? 'pending' : params.payment);
  const badge = planBadge(state);
  const personal = state.kind === 'personal';

  // A personal page pays nothing and has no billing story to tell, so it is
  // asked for none of these.
  const [usage, leads, orders, payments, account] = personal
    ? [null, 0, 0, [], null]
    : await Promise.all([
        getConversationUsage(page.id, now),
        countLeadsThisMonth(page.id, now),
        countOrdersThisMonth(page.id, now),
        getRecentPayments(page.id),
        getSignInMethods(owner.accountId),
      ]);
  const orderMeter = ordersNote(
    orderState({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now }),
  );

  // Exactly the conditions the API enforces (billing.service.ts, resetTrial).
  // A button that leads to a 409 is worse than no button.
  const canReset = page.mode === 'BUSINESS' && page.paidUntil === null && page.trialResetAt === null &&
    (page.leadsCaptured >= 1 || page.ordersPlaced > page.ordersAtTrialReset);

  const head = planHead(state, now);
  const paidUntil = state.kind === 'paid' ? state.paidUntil : null;
  const options: PayOption[] = PLANS.map((p) => {
    const after = extendPaidUntil({ paidUntil: page.paidUntil, now, plan: p.plan });
    const span = after.getTime() - now.getTime();
    return {
      ...p,
      price: ringgit(PLAN_PRICES_CENTS[p.plan]),
      afterShort: shortDateFrom(after, now),
      afterLong: shortDate(after, true),
      paidPct: paidUntil && span > 0 ? ((paidUntil.getTime() - now.getTime()) / span) * 100 : 0,
    };
  });
  // Billplz's page for a paid bill is its receipt.
  const billplz = process.env.BILLPLZ_BASE_URL?.replace(/\/+$/, '');
  const trialUsed = state.kind === 'trial' ? state.used : state.kind === 'trialSpent' ? FREE_LEADS : null;

  return (
    <>
      <PageHead title="Billing" note="Your plan, what this month has used, and what you have paid" />
      {paidNow ? <PaidToast until={shortDate(state.paidUntil, true)} /> : null}
      <div className={styles.bl}>
        {banner ? (
          <p className={styles.banner} data-tone={banner.tone} role="status">
            {banner.text}
          </p>
        ) : null}

        <div className={styles.top} data-personal={personal || undefined}>
          <section className={styles.card} aria-labelledby="plan-title">
            <h2 id="plan-title" className={styles.lab}>
              Your plan
              <span className={styles.tag} data-tone={badge.tone}>
                {badge.text}
              </span>
            </h2>

            {head ? (
              <>
                <p className={styles.big}>
                  <b>
                    <CountUp value={head.big} />
                  </b>
                  <span>{head.unit}</span>
                </p>
                <p className={styles.sub}>{head.sub}</p>
              </>
            ) : (
              <p className={styles.sub}>{planSummary(state)}</p>
            )}

            {trialUsed !== null ? (
              <>
                <div className={styles.segs} aria-hidden="true">
                  {Array.from({ length: FREE_LEADS }, (_, i) => (
                    <span key={i} data-used={i < trialUsed || undefined} />
                  ))}
                </div>
                <p className={styles.segNote}>
                  {trialUsed} of {FREE_LEADS} used
                </p>
              </>
            ) : null}

            {personal ? (
              <div className={styles.upgrade}>
                <h3>Selling something?</h3>
                <p>
                  A business page can take customers&apos; phone numbers: {FREE_LEADS} free leads, then {ringgit(PLAN_PRICES_CENTS.MONTHLY)} a month. Questions asked
                  three or more times get their own FAQ pages, and the page appears in search results.
                </p>
                <UpgradeToBusiness />
              </div>
            ) : (
              <PayButtons
                options={options}
                timeline={state.kind === 'paid' || state.kind === 'lapsed' ? { today: shortDate(now), paidUntil: paidUntil ? shortDate(paidUntil) : null } : undefined}
              />
            )}

            {canReset ? (
              <div className={styles.reset}>
                <p>
                  <b>Spent your trial testing your own page?</b> Every lead counts, including the ones you captured yourself. You can put the counter back to zero
                  once, and only while the page has never paid.
                </p>
                <ResetTrial />
              </div>
            ) : null}
          </section>

          {usage ? (
            <section className={`${styles.card} ${styles.use}`} aria-labelledby="month-title">
              <h2 id="month-title" className={styles.lab}>
                This month
              </h2>
              <Meter
                label="Conversations"
                used={usage.used}
                of={`of ${usage.cap.toLocaleString('en-MY')}`}
                share={usage.cap > 0 ? (usage.used / usage.cap) * 100 : 0}
                tone={usage.used > usage.cap ? 'merah' : usage.used >= usage.cap * NEAR_SHARE ? 'kuning' : 'biru'}
              >
                {usage.used > usage.cap
                  ? `Past the limit: the chat is giving a short fixed reply until ${shortDate(usageResets(now))}.`
                  : `Resets ${shortDate(usageResets(now))}. Past the limit, the chat gives a short fixed reply.`}
              </Meter>
              <Meter label="Orders" used={orders} of={orderMeter.paid ? 'no limit' : 'this month'} share={orderMeter.paid ? 100 : 0} tone="hijau">
                {orderMeter.note}
              </Meter>
              <Meter
                label="Leads"
                used={leads}
                of={state.kind === 'paid' ? 'no limit' : 'this month'}
                share={state.kind === 'paid' ? 100 : 0}
                tone="rose"
              >
                {state.kind === 'paid'
                  ? 'The capture card stays on your page.'
                  : state.kind === 'trial'
                    ? `${state.remaining} of your ${FREE_LEADS} free leads left. After that, the capture card needs a plan.`
                    : 'The capture card is off until you pay.'}
              </Meter>
              <div className={styles.inc}>
                <h3 className={styles.lab}>Included in Business</h3>
                <ul>
                  {INCLUDED.map((item) => (
                    <li key={item}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>

        {personal ? null : (
          <section aria-labelledby="payments-title">
            <div className={styles.h}>
              <h2 id="payments-title">Payments</h2>
              {account ? <span>Receipts go to {account.email}</span> : null}
            </div>
            {payments.length === 0 ? (
              <div className={styles.es}>
                <div className={styles.esArt} aria-hidden="true">
                  <div className={styles.esRows}>
                    <span data-tone="biru">
                      <i />
                      <b />
                      <em />
                    </span>
                    <span data-tone="hijau">
                      <i />
                      <b />
                      <em />
                    </span>
                    <span data-tone="amber">
                      <i />
                      <b />
                      <em />
                    </span>
                  </div>
                  <span className={styles.esBadge}>
                    <svg viewBox="0 0 24 24">
                      <path d="M3 6h18v13H3zM3 10h18" />
                    </svg>
                  </span>
                </div>
                <h3>No payments yet</h3>
                <p>When you pay for Business, the receipt shows up here and goes to your email.</p>
              </div>
            ) : (
              <table className={styles.tab}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">What for</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className={styles.sr}>Receipt</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const row = paymentParts(payment);
                    return (
                      <tr key={payment.id}>
                        <td>{row.date}</td>
                        <td title={row.until ? `Covers you until ${row.until}` : undefined}>{row.what}</td>
                        <td className={styles.am}>{row.amount}</td>
                        <td>
                          <span className={styles.st} data-paid={row.paid || undefined}>
                            <i aria-hidden="true" />
                            {row.paid ? 'Paid' : 'Not completed'}
                          </span>
                        </td>
                        <td>
                          {row.paid && payment.billplzBillId && billplz ? (
                            <a href={`${billplz}/bills/${payment.billplzBillId}`} target="_blank" rel="noopener noreferrer">
                              Receipt
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </>
  );
}

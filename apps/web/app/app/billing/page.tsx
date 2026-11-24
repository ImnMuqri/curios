import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  extendPaidUntil,
  monthsFree,
  orderState,
  planState,
  SESSION_COOKIE,
  type BillingPlan,
  type OrderState,
  type PlanState,
} from '@curios/core';
import { ringgit } from '@curios/core/money';
import { countLeadsThisMonth, countOrdersThisMonth, getConversationUsage, getOwnerPage, getPaymentResult, getRecentPayments, getRenewalCard, getSettings, getSignInMethods } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { daysLeft, formatDate, paidLine, paymentBanner, paymentNotice, paymentParts, planSummary, shortDate, usageResets } from './billing-copy.js';
import { AutoRenew } from './auto-renew.js';
import { PayButtons, type PayOption } from './pay-buttons.js';
import { PayDialogProvider } from './pay-context.js';
import { PaymentToast } from './payment-toast.js';
import { ResetTrial } from './reset-button.js';
import { UpgradeToBusiness } from './upgrade-button.js';
import styles from './billing.module.css';
import { PageHead } from '../_ui/page-head.js';
import { CountUp } from '../_ui/count-up.js';
import { LivePeek } from '../../_peek/LivePeek.js';
import { NEAR_SHARE } from '../alerts.js';

const PLANS: { plan: BillingPlan; name: string; note: string; period: string; unit: string }[] = [
  { plan: 'MONTHLY', name: 'Monthly', note: 'One month at a time', period: 'a month', unit: 'month' },
  { plan: 'ANNUAL', name: 'Yearly', note: 'Paid once a year', period: 'a year', unit: 'year' },
];

/** The yearly plan's "2 months free", from the prices in force; nothing when they give no whole month. */
function yearlySaving(prices: { MONTHLY: number; ANNUAL: number }): string | undefined {
  const months = monthsFree(prices);
  return months === null ? undefined : `${months} ${months === 1 ? 'month' : 'months'} free`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The line under the plan's name, and how much of a month a paid plan has left (for the bar).
 * Paid is the board's: "18 days left. Paid until 2 Dec 2026." and whether a card pays again. A trial,
 * which the board does not draw, says how many free leads are left; the rest say where the plan stands.
 */
function planLine(state: PlanState, now: Date, renews: boolean, freeLeads: number): { line: string; share: number | null } {
  switch (state.kind) {
    case 'personal':
      return { line: planSummary(state, freeLeads), share: null };
    case 'paid': {
      const days = daysLeft(state.paidUntil, now);
      // A plain bar of a month: full from a month up (a yearly plan stays full for a long while).
      return { line: paidLine(days, shortDate(state.paidUntil, true), renews), share: Math.min(100, (days / 30) * 100) };
    }
    case 'trial':
      return {
        line: state.lapsedOn
          ? planSummary(state, freeLeads)
          : `${state.remaining} ${plural(state.remaining, 'free lead', 'free leads')} left. Answering is free forever. Your first ${freeLeads} numbers are free too. After that, the capture card on your page needs a plan.`,
        share: null,
      };
    case 'trialSpent':
    case 'lapsed':
      return { line: planSummary(state, freeLeads), share: null };
  }
}

/**
 * The Orders meter's line. Paid is the board's; the board draws no trial, so a
 * trial counts the free orders the way the plan card counts the free leads, and
 * a spent one says the shop has stopped, as Store's "Open for orders" does.
 */
function ordersNote(state: OrderState, freeOrders: number): { paid: boolean; note: string } {
  const stopped = 'Your shop takes no orders until you pay.';
  switch (state.kind) {
    case 'paid':
      return { paid: true, note: 'Take as many as you get.' };
    case 'trial':
      return { paid: false, note: `${state.used} of ${freeOrders} free orders used` };
    case 'trialSpent':
      return { paid: false, note: `${freeOrders} of ${freeOrders} free orders used. ${stopped}` };
    case 'lapsed':
      return { paid: false, note: `Your plan ended on ${shortDate(state.paidUntil, true)}. ${stopped}` };
    case 'personal':
      return { paid: false, note: '' };
  }
}

/**
 * A thing used this month, as the board's card: what it is, the count, a line under it. Only the
 * conversations carry a bar, because only they have a cap to fill.
 */
function Meter({ label, value, bar, children }: { label: string; value: ReactNode; bar?: { share: number; tone: 'biru' | 'kuning' | 'merah' }; children: ReactNode }) {
  return (
    <div className={styles.u}>
      <p className={styles.mh}>
        <span>{label}</span>
        <b>{value}</b>
      </p>
      {bar ? (
        <div className={styles.mbar} data-tone={bar.tone} aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, bar.share))}%` }} />
        </div>
      ) : null}
      <small>{children}</small>
    </div>
  );
}

/**
 * Where the plan stands, what the month has used, and what has been paid, from
 * the design handoff's Dash board; and the things an owner can do about it:
 * pay for more time, or -- once, and only for a page that never paid -- take
 * back a trial they spent testing their own page. A personal page has nothing
 * to pay for, and is offered the switch to business instead.
 *
 * Coming back from CHIP lands here: the API redirects with `?paid=<id>`, `?failed=<id>` or
 * `?checking=<id>` (our own payment id), and the toast says what the payment's own record says.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; pay?: string; paid?: string; failed?: string; checking?: string }>;
}) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const now = new Date();
  // The prices and allowances in force, the ones the API charges and counts by.
  const settings = await getSettings();
  const { freeLeads, freeOrders, prices } = settings;
  const state = planState({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now }, freeLeads);
  // Back from CHIP with no payment to look up (the return could not name one): a line, as before.
  const banner = paymentBanner(params.payment);
  // Back from CHIP with our payment id: the toast. The id is looked up for this owner's page only, so a
  // hand-typed one shows nothing of anyone else's, and what it says comes from the record, not the query.
  const via = params.paid ? 'paid' : params.failed ? 'failed' : 'checking';
  const noticeId = params.paid ?? params.failed ?? params.checking;
  const result = noticeId ? await getPaymentResult(page.id, noticeId) : null;
  const personal = state.kind === 'personal';

  // A personal page pays nothing and has no billing story to tell, so it is
  // asked for none of these.
  // While the admin has CHIP payments off, the pay buttons give way to a line that says so.
  const paymentsOn = personal ? true : settings.switches.chipPayments;
  const [usage, leads, orders, payments, account, card] = personal
    ? [null, 0, 0, [], null, null]
    : await Promise.all([
        getConversationUsage(page.id, now),
        countLeadsThisMonth(page.id, now),
        countOrdersThisMonth(page.id, now),
        getRecentPayments(page.id),
        getSignInMethods(owner.accountId),
        getRenewalCard(page.id),
      ]);
  // Auto-renew was asked for and no card is kept: the plan is paid, but nothing will renew itself. Said from
  // our own records (the saved card), not from anything in the address.
  const notice = paymentNotice(result, via, card === null);
  const orderMeter = ordersNote(
    orderState({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now }, freeOrders),
    freeOrders,
  );

  // Exactly the conditions the API enforces (billing.service.ts, resetTrial).
  // A button that leads to a 409 is worse than no button.
  const canReset = page.mode === 'BUSINESS' && page.paidUntil === null && page.trialResetAt === null &&
    (page.leadsCaptured >= 1 || page.ordersPlaced > page.ordersAtTrialReset);

  const head = planLine(state, now, card !== null, freeLeads);
  const save = yearlySaving(prices);
  const options: PayOption[] = PLANS.map((p) => ({
    ...p,
    ...(p.plan === 'ANNUAL' && save ? { save } : {}),
    price: ringgit(prices[p.plan]),
    afterLong: formatDate(extendPaidUntil({ paidUntil: page.paidUntil, now, plan: p.plan })),
  }));
  const trialUsed = state.kind === 'trial' ? state.used : state.kind === 'trialSpent' ? freeLeads : null;
  const unlimited = state.kind === 'paid';

  return (
    <PayDialogProvider initialOpen={params.pay === '1'}>
      <PageHead kicker="Account" title="Billing" summary="Your plan, this month’s usage and what you have paid." />
      <div className={styles.bl}>
        {banner ? (
          <p className={styles.banner} data-tone={banner.tone} role="status">
            {banner.text}
          </p>
        ) : null}

        {/* The board's status cards, above the plan: auto-renew on or failing, or a personal page. */}
        {personal ? (
          <div className={styles.stc}>
            <div className={styles.xcard}>
              <span className={styles.xok} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <div className={styles.xct}>
                <b>Selling something?</b>
                <p>This is a personal page. It answers questions about you. A business page takes numbers and runs a shop.</p>
                {/* Not on the board, which leaves it out for room: what the owner is choosing between. */}
                <p>
                  Business gives you {freeLeads} free leads, then {ringgit(prices.MONTHLY)} a month.
                </p>
                <UpgradeToBusiness />
              </div>
            </div>
          </div>
        ) : (
          // Whatever the plan state: the job keeps charging up to 3 days after the plan
          // ends, and the owner must be able to stop that from here.
          <div className={styles.stc}>
            <AutoRenew
              card={
                card && page.mode === 'BUSINESS'
                  ? {
                      label: card.cardLabel,
                      price: ringgit(prices[card.plan]),
                      paidUntil: page.paidUntil ? shortDate(page.paidUntil, true) : null,
                      failed: card.failedAttempts > 0,
                      ended: state.kind !== 'paid',
                    }
                  : null
              }
              canPay={paymentsOn}
            />
          </div>
        )}

        {personal ? null : (
          <div className={styles.plan2}>
            <section className={styles.pc2} aria-labelledby="plan-title">
              <span className={styles.pkc} aria-hidden="true">
                <LivePeek width={76} follow />
              </span>
              <p className={styles.k}>Your plan</p>
              <h2 id="plan-title">Business</h2>
              <p className={styles.pline}>{head.line}</p>

              {head.share !== null ? (
                <div className={styles.bar2} aria-hidden="true">
                  <i style={{ width: `${head.share}%` }} />
                </div>
              ) : null}

              {trialUsed !== null ? (
                <>
                  <div className={styles.segs} aria-hidden="true">
                    {Array.from({ length: freeLeads }, (_, i) => (
                      <span key={i} data-used={i < trialUsed || undefined} />
                    ))}
                  </div>
                  <p className={styles.segNote}>
                    {trialUsed} of {freeLeads} used
                  </p>
                </>
              ) : null}

              {paymentsOn ? (
                <PayButtons options={options} initialOpen={params.pay === '1'} />
              ) : (
                <p className={styles.banner} role="status">
                  Online payments are paused for a moment. Try again soon.
                </p>
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
              <section className={styles.use} aria-labelledby="month-title">
                <h2 id="month-title" className={styles.sr}>
                  This month
                </h2>
                <Meter
                  label="Conversations"
                  value={
                    <>
                      <CountUp value={usage.used} /> of {usage.cap.toLocaleString('en-MY')}
                    </>
                  }
                  bar={{
                    share: usage.cap > 0 ? (usage.used / usage.cap) * 100 : 0,
                    tone: usage.used > usage.cap ? 'merah' : usage.used >= usage.cap * NEAR_SHARE ? 'kuning' : 'biru',
                  }}
                >
                  {usage.used > usage.cap
                    ? `Past the limit: the chat is giving a short fixed reply until ${shortDate(usageResets(now))}.`
                    : `Resets ${shortDate(usageResets(now))}. Past the limit, the chat gives a short fixed reply.`}
                </Meter>
                <Meter
                  label="Orders"
                  value={
                    <>
                      <CountUp value={orders} /> {orderMeter.paid ? '· no limit' : 'this month'}
                    </>
                  }
                >
                  {orderMeter.note}
                </Meter>
                <Meter
                  label="Leads"
                  value={
                    <>
                      <CountUp value={leads} /> {unlimited ? '· no limit' : 'this month'}
                    </>
                  }
                >
                  {unlimited
                    ? 'The capture card stays on your page.'
                    : state.kind === 'trial'
                      ? `${state.remaining} of your ${freeLeads} free leads left. After that, the capture card needs a plan.`
                      : 'The capture card is off until you pay.'}
                </Meter>
              </section>
            ) : null}
          </div>
        )}

        {personal ? null : (
          <section id="payments" className={styles.pays} aria-labelledby="payments-title">
            <h2 id="payments-title">Payments</h2>
            {account ? <p className={styles.recv}>Receipts go to {account.email}</p> : null}
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
                <p>When you pay for Business, it shows up here, and CHIP emails you the receipt.</p>
              </div>
            ) : (
              <table className={styles.tab}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">What for</th>
                    <th scope="col">Status</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const row = paymentParts(payment);
                    return (
                      <tr key={payment.id}>
                        <td>{row.date}</td>
                        <td title={row.until ? `Covers you until ${row.until}` : undefined}>{row.what}</td>
                        <td>
                          <span className={styles.st} data-paid={row.paid || undefined} data-declined={row.status === 'Declined' || undefined}>
                            <i aria-hidden="true" />
                            {row.status}
                          </span>
                        </td>
                        <td className={styles.am}>{row.amount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
      <PaymentToast notice={notice} canPay={paymentsOn} />
    </PayDialogProvider>
  );
}

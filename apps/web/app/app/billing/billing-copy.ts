import type { PlanState } from '@curios/core';
import { ringgit } from '@curios/core/money';
import type { OwnerPayment, PaymentResult } from '@curios/db-read';

const MALAYSIAN_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kuala_Lumpur',
};

/**
 * A date as an owner in Malaysia reads it: the calendar day in their own time zone.
 * paidUntil is stored in UTC, and 20:00 UTC is already tomorrow in Kuala Lumpur.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-MY', MALAYSIAN_DATE);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "14 Nov", or "14 Nov 2026" with the year: the board's short dates, on the
 * Malaysian calendar. Built from the parts because every locale's short month
 * writes September as "Sept".
 */
export function shortDate(date: Date, withYear = false): string {
  const parts = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${Number(part('day'))} ${MONTHS[Number(part('month')) - 1]}`;
  return withYear ? `${day} ${part('year')}` : day;
}

/** Whole days left until `until`, counting a part day as one; never below zero. */
export function daysLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

/** When this month's conversations start again: the first of next month, as the counter keys it (UTC). */
export function usageResets(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * The plan card's line for a paid plan, as the board says it: the days, the date, and whether a card
 * will pay again. "18 days left. Paid until 2 Dec 2026. No auto-renew, so nothing is charged without you."
 */
export function paidLine(days: number, until: string, renews: boolean): string {
  const left = `${days} ${days === 1 ? 'day' : 'days'} left. Paid until ${until}.`;
  return renews ? `${left} Renews by card on ${until}.` : `${left} No auto-renew, so nothing is charged without you.`;
}

/** `freeLeads`: the allowance in force, the one `state` was counted against. */
export function planSummary(state: PlanState, freeLeads: number): string {
  switch (state.kind) {
    case 'personal':
      return 'Personal pages are free. There is nothing to pay for.';
    case 'paid':
      return `Your plan is paid through ${formatDate(state.paidUntil)}.`;
    case 'trial':
      // A trial can outlive a subscription -- planState's `lapsedOn`. Calling it
      // a plain free trial would tell an owner who has paid that they never did,
      // and the plan-ended banner (alerts.ts), which says both halves, would disagree.
      return state.lapsedOn
        ? `Your plan ended on ${formatDate(state.lapsedOn)}. You have ${state.remaining} free leads left before the capture card stops.`
        : `You are on the free trial: ${state.used} of ${freeLeads} free leads used.`;
    case 'trialSpent':
      return `All ${freeLeads} of your free leads are used. Pay to keep the capture card on your page.`;
    case 'lapsed':
      return `Your plan ended on ${formatDate(state.paidUntil)}. Pay to turn the capture card back on.`;
  }
}

/**
 * One payment as the payments table shows it. A paid one is dated by when it
 * was paid; one that never completed by when it was started, because it has no
 * payment date and the owner remembers starting it. A renewal the job charged
 * says so, and a refused one reads "Declined" where an abandoned checkout
 * reads "Not completed": the owner did nothing wrong in the second.
 */
export function paymentParts(payment: OwnerPayment): {
  date: string;
  what: string;
  amount: string;
  paid: boolean;
  until: string | null;
  status: 'Paid' | 'Not completed' | 'Declined';
} {
  const paid = payment.status === 'PAID' && payment.paidAt !== null;
  const span = `1 ${payment.plan === 'ANNUAL' ? 'year' : 'month'}`;
  return {
    date: shortDate(paid && payment.paidAt ? payment.paidAt : payment.createdAt, true),
    what: payment.autoRenewal ? `Auto-renewal, ${span}` : `Business, ${span}`,
    amount: ringgit(payment.amountCents),
    paid,
    until: paid && payment.grantedUntil ? formatDate(payment.grantedUntil) : null,
    status: paid ? 'Paid' : payment.status === 'FAILED' ? 'Declined' : 'Not completed',
  };
}

export interface PaymentBanner {
  tone: 'info' | 'error';
  text: string;
}

/**
 * What the screen says on returning from CHIP, keyed on the value the API's return
 * route redirects with. Anything else says nothing: a hand-typed query string must not
 * make the screen claim a payment happened.
 */
export function paymentBanner(value: string | undefined): PaymentBanner | null {
  switch (value) {
    // Only for a return with no payment id to look up; one with an id is a toast (paymentNotice).
    case 'pending':
      return {
        tone: 'info',
        text: 'We are still confirming your payment with CHIP. It will show here once it is confirmed.',
      };
    case 'failed':
      return {
        tone: 'error',
        text: 'The payment did not go through, and nothing was charged. You can try again below.',
      };
    default:
      return null;
  }
}

/** What the toast says on coming back from CHIP: paid, not paid, or still being confirmed. */
export type PaymentNotice =
  | { kind: 'paid'; title: string; sub: string; note: string | null }
  | { kind: 'failed'; title: string; short: string; sub: string }
  | { kind: 'checking'; title: string; sub: string };

/**
 * The toast for a payment, from what the SERVER holds about it, never from the query string: the
 * redirect only says which payment to look at and what CHIP told us, and "Paid" is shown only for a
 * payment our own record says was granted (the return confirms with CHIP and grants before it
 * redirects; the webhook can also land first). Anything not settled yet is "checking", which the page
 * polls until it is.
 *
 * `via` is which redirect brought the owner here. A payment CHIP failed but our record still has
 * pending is a failure (`failed`); a return that could not reach CHIP (`checking`) is not decided.
 * An unknown payment, or someone else's, gives nothing.
 */
export function paymentNotice(result: PaymentResult | null, via: 'paid' | 'failed' | 'checking', cardOff: boolean): PaymentNotice | null {
  if (!result) return null;
  if (result.status === 'PAID') {
    if (!result.grantedUntil) return { kind: 'checking', title: 'Checking your payment…', sub: 'This takes a moment.' };
    return {
      kind: 'paid',
      title: `Paid ${ringgit(result.amountCents)}`,
      sub: `Business runs until ${shortDate(result.grantedUntil, true)}`,
      // Auto-renew was asked for and CHIP kept no card: the plan is paid, but nothing will renew itself.
      note: result.autoRenew && cardOff ? cardOffBanner().text : null,
    };
  }
  if (result.status === 'PENDING' && via !== 'failed') return { kind: 'checking', title: 'Checking your payment…', sub: 'This takes a moment.' };
  return { kind: 'failed', title: 'Payment didn’t go through', short: 'Didn’t go through', sub: 'Nothing was charged' };
}

/**
 * The toast's second line when the return redirect carried `card=off`: auto-renew was asked for but CHIP
 * kept no card. The plan itself is paid, so this is information, not an error.
 */
export function cardOffBanner(): PaymentBanner {
  return {
    tone: 'info',
    text: 'Your plan is paid, but auto-renew couldn’t be turned on for this payment. Pay by card with the box ticked next time to turn it on.',
  };
}

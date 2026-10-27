import type { PlanState } from '@curios/core';
import type { OwnerPayment } from '@curios/db-read';

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

/** A short date, with its year only when that is not this year's. */
export function shortDateFrom(date: Date, now: Date): string {
  const withYear = shortDate(date, true);
  return withYear.endsWith(shortDate(now, true).slice(-4)) ? shortDate(date) : withYear;
}

/** Whole days left until `until`, counting a part day as one; never below zero. */
export function daysLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

/** When this month's conversations start again: the first of next month, as the counter keys it (UTC). */
export function usageResets(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Whole ringgit without decimals, the way the prices are published: RM49, RM490. */
export function ringgit(cents: number): string {
  return cents % 100 === 0 ? `RM${cents / 100}` : `RM${(cents / 100).toFixed(2)}`;
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

/** The plan as its tag says it, and how loudly: amber once it has run out. */
export function planBadge(state: PlanState): { text: string; tone: 'biru' | 'muda' | 'kuning' } {
  switch (state.kind) {
    case 'personal':
      return { text: 'Personal', tone: 'muda' };
    case 'paid':
      return { text: 'Business', tone: 'biru' };
    case 'trial':
      return state.lapsedOn ? { text: 'Business · plan ended', tone: 'kuning' } : { text: 'Business · free trial', tone: 'biru' };
    case 'trialSpent':
      return { text: 'Business · trial used up', tone: 'kuning' };
    case 'lapsed':
      return { text: 'Business · plan ended', tone: 'kuning' };
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
    // A confirmed 'paid' is the page's toast, not a banner (paid-toast.tsx).
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

/**
 * The return redirect adds `card=off` when auto-renew was asked for but CHIP
 * kept no card. The plan itself is paid, so this is information, not an error.
 */
export function cardOffBanner(): PaymentBanner {
  return {
    tone: 'info',
    text: 'Your plan is paid, but auto-renew couldn’t be turned on for this payment. Pay by card with the box ticked next time to turn it on.',
  };
}

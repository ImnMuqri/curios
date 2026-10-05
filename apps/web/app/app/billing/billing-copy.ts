import { FREE_LEADS, type PlanState } from '@curios/core';
import type { ConversationUsage, OwnerPayment } from '@curios/db-read';

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

/** Whole ringgit without decimals, the way the prices are published: RM39, RM390. */
export function ringgit(cents: number): string {
  return cents % 100 === 0 ? `RM${cents / 100}` : `RM${(cents / 100).toFixed(2)}`;
}

export function planSummary(state: PlanState): string {
  switch (state.kind) {
    case 'personal':
      return 'Personal pages are free. There is nothing to pay for.';
    case 'paid':
      return `Your plan is paid through ${formatDate(state.paidUntil)}.`;
    case 'trial':
      // A trial can outlive a subscription -- planState's `lapsedOn`. Calling it
      // a plain free trial would tell an owner who has paid that they never did,
      // and the leads screen, which says both halves, would disagree with this.
      return state.lapsedOn
        ? `Your plan ended on ${formatDate(state.lapsedOn)}. You have ${state.remaining} free leads left before the capture card stops.`
        : `You are on the free trial: ${state.used} of ${FREE_LEADS} free leads used.`;
    case 'trialSpent':
      return `All ${FREE_LEADS} of your free leads are used. Pay to keep the capture card on your page.`;
    case 'lapsed':
      return `Your plan ended on ${formatDate(state.paidUntil)}. Pay to turn the capture card back on.`;
  }
}

/** The plan in two words, for the badge over the summary, and how loudly to say it. */
export function planBadge(state: PlanState): { text: string; tone: 'biru' | 'muda' | 'kuning' } {
  switch (state.kind) {
    case 'personal':
      return { text: 'Personal', tone: 'muda' };
    case 'paid':
      return { text: 'Business', tone: 'biru' };
    case 'trial':
      return state.lapsedOn ? { text: 'Plan ended', tone: 'kuning' } : { text: 'Free trial', tone: 'muda' };
    case 'trialSpent':
      return { text: 'Trial used up', tone: 'kuning' };
    case 'lapsed':
      return { text: 'Plan ended', tone: 'kuning' };
  }
}

/** One payment as the payments table shows it: when, what, and whether it went through. */
export function paymentParts(payment: OwnerPayment): { date: string; what: string; paid: boolean; until: string | null } {
  const paid = payment.status === 'PAID' && payment.paidAt !== null;
  return {
    date: formatDate(paid && payment.paidAt ? payment.paidAt : payment.createdAt),
    what: `${ringgit(payment.amountCents)} for ${payment.plan === 'ANNUAL' ? 'a year' : 'a month'}`,
    paid,
    until: paid && payment.grantedUntil ? formatDate(payment.grantedUntil) : null,
  };
}

export interface PaymentBanner {
  tone: 'info' | 'error';
  text: string;
}

/**
 * What the screen says on returning from Billplz, keyed on the value the API's return
 * route redirects with. Anything else says nothing: a hand-typed query string must not
 * make the screen claim a payment happened.
 */
export function paymentBanner(value: string | undefined): PaymentBanner | null {
  switch (value) {
    case 'paid':
      return { tone: 'info', text: 'Payment received. Your plan is active.' };
    case 'pending':
      return {
        tone: 'info',
        text: 'We are still confirming your payment with Billplz. It will show here once it is confirmed.',
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
 * Conversations this month against the cap in force.
 *
 * Over the cap, chat answers with a short fixed reply rather than the model --
 * that has already happened by the time an owner reads this, so the number
 * alone would understate it.
 */
export function usageSummary(usage: ConversationUsage): string {
  const counted = `${usage.used} of ${usage.cap} conversations used this month.`;
  return usage.used > usage.cap
    ? `${counted} Chat is answering with a short fixed reply until next month.`
    : counted;
}

/**
 * One line of payment history.
 *
 * A paid payment is dated by when it was paid; one that never completed is
 * dated by when it was started, because it has no payment date and the owner
 * remembers starting it. "Not completed" rather than "failed": most of these
 * are a bill someone opened and closed, not a payment that went wrong.
 */
export function paymentLine(payment: OwnerPayment): string {
  const period = payment.plan === 'ANNUAL' ? 'a year' : 'a month';
  const amount = ringgit(payment.amountCents);

  return payment.status === 'PAID' && payment.paidAt !== null
    ? `${formatDate(payment.paidAt)} — ${amount} for ${period}, paid`
    : `${formatDate(payment.createdAt)} — ${amount} for ${period}, not completed`;
}

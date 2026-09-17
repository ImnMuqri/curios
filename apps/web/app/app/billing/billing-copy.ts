import { FREE_LEADS, type PlanState } from '@curios/core';

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
      return `You are on the free trial: ${state.used} of ${FREE_LEADS} free leads used.`;
    case 'trialSpent':
      return `All ${FREE_LEADS} of your free leads are used. Pay to keep the capture card on your page.`;
    case 'lapsed':
      return `Your plan ended on ${formatDate(state.paidUntil)}. Pay to turn the capture card back on.`;
  }
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

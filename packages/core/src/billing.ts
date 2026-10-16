/**
 * What a plan costs, in cents -- Billplz's unit, and the only unit money moves in here.
 *
 * Constants, not env vars, for FREE_LEADS's reason: this is a promise printed on a
 * pricing page, not an operational dial. A Payment stores the amount it was billed
 * at, so changing these never alters a bill already issued.
 */
export const PLAN_PRICES_CENTS = { MONTHLY: 4900, ANNUAL: 49000 } as const;

export type BillingPlan = keyof typeof PLAN_PRICES_CENTS;

/**
 * The paidUntil a payment of `plan` produces.
 *
 * Counts from whichever is later, now or the current paidUntil, so renewing early
 * stacks and renewing after a lapse starts fresh. Adds one calendar month or year in
 * UTC, clamped to the last day of a shorter month -- Jan 31 plus a month is the last
 * day of February. A fixed 30 days would cost a monthly owner about five days a year.
 *
 * `now` is a parameter so the month-end boundaries can be tested.
 */
export function extendPaidUntil(input: {
  paidUntil: Date | null;
  now: Date;
  plan: BillingPlan;
}): Date {
  const base =
    input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()
      ? input.paidUntil
      : input.now;
  return addCalendarMonths(base, input.plan === 'ANNUAL' ? 12 : 1);
}

function addCalendarMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

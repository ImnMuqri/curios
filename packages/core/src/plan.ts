/**
 * How many leads a page may capture before it has to pay.
 *
 * Three, and counted rather than timed. A fourteen-day trial can expire having
 * produced nothing, which teaches an owner the product does not work and
 * spends the model budget proving it; a lead trial ends only once the product
 * has demonstrably worked. A page that never captures anything never pays and
 * never feels cheated.
 *
 * Not an env var, unlike the conversation cap. That one is an operational dial
 * for spend; this is a promise printed on a pricing page.
 */
export const FREE_LEADS = 3;

/**
 * Whether this page may take a phone number.
 *
 * The one thing a lapsed page loses. Everything else it keeps -- the FAQ pages
 * stay indexed, the public page stays indexed, chat keeps answering at the
 * same cap. Withdrawing FAQ generation would 404 URLs the owner earned in
 * search, and rankings do not return the moment a bill is paid. Capture is
 * what README says a business pays for, so capture is what stops.
 *
 * `now` is a parameter and not `new Date()`, the same as every other rule in
 * this package: a function that reads the clock cannot be tested at the
 * instant its answer changes.
 */
export function canCapture(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  paidUntil: Date | null;
  leadsCaptured: number;
  now: Date;
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  // `>` and not `>=`: the instant a payment expires, it has expired.
  if (input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()) return true;
  return input.leadsCaptured < FREE_LEADS;
}

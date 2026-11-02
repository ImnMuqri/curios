/**
 * What CHIP's status for an unpaid purchase means in plain words. One reason
 * drives both the billing page ("What happened") and the shop's failed-payment
 * page ("The bank said"), so the two never disagree.
 */

export type FailReason = 'cancelled' | 'expired' | 'declined' | 'unfinished';

export const FAIL_REASONS: readonly FailReason[] = ['cancelled', 'expired', 'declined', 'unfinished'];

/** For a reason that arrives from outside, such as a query string. */
export function isFailReason(value: unknown): value is FailReason {
  return FAIL_REASONS.includes(value as FailReason);
}

/** Anything CHIP reports that is not one of the named failures did not finish. */
export function failReason(status: string): FailReason {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expired') return 'expired';
  if (status === 'error' || status === 'failed' || status === 'blocked') return 'declined';
  return 'unfinished';
}

/** The billing page's "What happened". */
export const FAIL_WHAT_HAPPENED: Record<FailReason, string> = {
  cancelled: 'Cancelled at bank',
  expired: 'Took too long',
  declined: 'Bank declined',
  unfinished: "Didn't finish",
};

/** The shop's failed-payment page, after "The bank said". */
export const FAIL_BANK_SAID: Record<FailReason, string> = {
  cancelled: 'cancelled',
  expired: 'it took too long',
  declined: 'declined',
  unfinished: "it didn't finish",
};

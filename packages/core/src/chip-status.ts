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

/** The CHIP statuses of a purchase that failed for good, each with its reason. */
const FAILED: Record<string, FailReason> = {
  cancelled: 'cancelled',
  expired: 'expired',
  error: 'declined',
  failed: 'declined',
  blocked: 'declined',
};

/** A purchase nobody will ever pay: the billing return sends these to the failed page, rather than "pending". */
export const FAILED_PURCHASE_STATUSES: ReadonlySet<string> = new Set(Object.keys(FAILED));

/** Anything CHIP reports that is not one of the named failures did not finish. */
export function failReason(status: string): FailReason {
  return Object.hasOwn(FAILED, status) ? FAILED[status]! : 'unfinished';
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

import { prismaRead } from './client.js';

export interface OwnerPayment {
  id: string;
  plan: 'MONTHLY' | 'ANNUAL';
  amountCents: number;
  /** Which processor took it. Old rows are Billplz; a GRANT is a month the Curios team gave. */
  provider: 'BILLPLZ' | 'CHIP' | 'GRANT';
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  /** A renewal charge made by the job against the saved card, not a checkout the owner started. */
  autoRenewal: boolean;
  /** Null until a payment is granted, and null forever for one that never was. */
  paidAt: Date | null;
  /** The paidUntil this payment produced. */
  grantedUntil: Date | null;
  createdAt: Date;
}

/**
 * How many payments the billing screen lists. A fixed number rather than a
 * parameter: there is one caller, five rows is what the screen has room for,
 * and an unused limit argument is an untested code path.
 */
export const RECENT_PAYMENTS = 5;

/**
 * This page's most recent payments, newest first.
 *
 * Scoped to one page inside the query, the way the leads query is: what someone
 * paid is theirs, and a screen that could be handed the wrong page id should
 * still be unable to show another owner's money.
 *
 * Pending rows are included deliberately. A payment that was started and never
 * completed is the thing an owner is most likely to be asking about.
 */
export async function getRecentPayments(pageId: string): Promise<OwnerPayment[]> {
  return prismaRead.payment.findMany({
    where: { pageId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_PAYMENTS,
    select: {
      id: true,
      plan: true,
      amountCents: true,
      provider: true,
      autoRenewal: true,
      status: true,
      paidAt: true,
      grantedUntil: true,
      createdAt: true,
    },
  });
}

/** The card a page has saved for renewing itself: what the owner is told, and nothing that could charge it. */
export interface OwnerRenewalCard {
  cardLabel: string | null;
  plan: 'MONTHLY' | 'ANNUAL';
  failedAttempts: number;
}

/**
 * This page's saved card, or null when auto-renew is off.
 *
 * The select names three columns and leaves `token` out on purpose: it is
 * CHIP's recurring token, what the renewal job charges, and a web screen has
 * no use for it. A column that is never selected cannot leak.
 */
export async function getRenewalCard(pageId: string): Promise<OwnerRenewalCard | null> {
  return prismaRead.renewalCard.findUnique({
    where: { pageId },
    select: { cardLabel: true, plan: true, failedAttempts: true },
  });
}

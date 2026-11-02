import { prismaRead } from './client.js';

/** What the paid and failed pages say about one plan payment. */
export interface PaymentResult {
  plan: 'MONTHLY' | 'ANNUAL';
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  /** How the payer paid, as CHIP reported it ("FPX · Maybank2u"); null until a grant records it. */
  paidVia: string | null;
  /** The first 8 characters of CHIP's purchase id, uppercased: short enough to quote to support. */
  reference: string | null;
  /** The paidUntil this payment produced; null for one that never granted. */
  grantedUntil: Date | null;
  /** The buyer asked for the card to be kept; whether CHIP kept one is another matter. */
  autoRenew: boolean;
}

/**
 * One payment, for the page the owner lands on after CHIP.
 *
 * Scoped to the page inside the query, as `getRecentPayments` is: the id arrives in a
 * URL, and a URL someone edited must not show another owner's money. Null for an id
 * that is not this page's.
 */
export async function getPaymentResult(pageId: string, paymentId: string): Promise<PaymentResult | null> {
  const payment = await prismaRead.payment.findFirst({
    where: { id: paymentId, pageId },
    select: { plan: true, amountCents: true, status: true, paidVia: true, providerRef: true, grantedUntil: true, autoRenew: true },
  });
  if (!payment) return null;
  const { providerRef, ...rest } = payment;
  return { ...rest, reference: providerRef ? providerRef.slice(0, 8).toUpperCase() : null };
}

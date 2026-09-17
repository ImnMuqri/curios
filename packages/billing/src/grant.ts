import { extendPaidUntil } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { BillplzBill } from './client.js';

/**
 * A bill as a grant needs it, from one of two places: the callback's own fields, or a
 * bill fetched from Billplz by the redirect or the hourly check.
 */
export interface BillEvidence {
  billId: string;
  collectionId: string;
  paid: boolean;
  state: string;
  paidAmount: number;
  /** Only a fetched bill has one. The callback does not carry reference_1. */
  reference1?: string | null;
}

export type GrantOutcome =
  | { kind: 'granted'; paidUntil: Date }
  | { kind: 'already-granted' }
  | { kind: 'not-paid' }
  | { kind: 'unknown-bill' }
  | { kind: 'mismatch'; reason: 'collection' | 'amount' | 'reference' };

export interface GrantOptions {
  now: Date;
  /**
   * Test-only. Runs inside the transaction, after paidUntil has been read under the
   * lock and before it is written, so a test can hold that window open and prove the
   * lock is what stops a second payment reading a stale paidUntil.
   */
  afterRead?: () => Promise<void>;
}

export function evidenceFromCallback(params: Record<string, string>): BillEvidence {
  const paidAmount = params.paid_amount ?? '';
  return {
    billId: params.id ?? '',
    collectionId: params.collection_id ?? '',
    paid: params.paid === 'true',
    state: params.state ?? '',
    // Whole cents only. Anything else -- "39.00", "" -- matches no stored amount.
    paidAmount: /^\d+$/.test(paidAmount) ? Number(paidAmount) : Number.NaN,
  };
}

export function evidenceFromBill(bill: BillplzBill): BillEvidence {
  return {
    billId: bill.id,
    collectionId: bill.collectionId,
    paid: bill.paid,
    state: bill.state,
    paidAmount: bill.paidAmount,
    reference1: bill.reference1,
  };
}

/**
 * The one step that turns a paid bill into paid time. The callback, the redirect and
 * the hourly check all come here, and nothing else writes Page.paidUntil.
 *
 * Binding first: the bill must be one we created, found by its unique id; in the
 * collection and for the amount we stored; and -- when it was fetched, and so carries
 * a reference -- referencing this payment. Then one transaction. The payment is claimed
 * with a conditional update, so a second arrival of the same bill changes nothing. The
 * page row is locked, so a second payment for the same page waits and reads this one's
 * result instead of the old paidUntil. Then extend, and write.
 */
export async function grantPayment(
  prisma: PrismaClient,
  evidence: BillEvidence,
  options: GrantOptions,
): Promise<GrantOutcome> {
  if (!evidence.paid || evidence.state !== 'paid') return { kind: 'not-paid' };

  const payment = await prisma.payment.findUnique({
    where: { billplzBillId: evidence.billId },
    select: {
      id: true,
      pageId: true,
      plan: true,
      amountCents: true,
      billplzCollectionId: true,
      status: true,
    },
  });
  if (!payment) return { kind: 'unknown-bill' };
  if (payment.billplzCollectionId !== evidence.collectionId) return { kind: 'mismatch', reason: 'collection' };
  if (payment.amountCents !== evidence.paidAmount) return { kind: 'mismatch', reason: 'amount' };
  if (evidence.reference1 !== undefined && evidence.reference1 !== payment.id) {
    return { kind: 'mismatch', reason: 'reference' };
  }
  if (payment.status === 'PAID') return { kind: 'already-granted' };

  return prisma.$transaction(async (tx): Promise<GrantOutcome> => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: options.now },
    });
    if (claimed.count === 0) return { kind: 'already-granted' };

    const rows = await tx.$queryRaw<{ paidUntil: Date | null }[]>`
      SELECT "paidUntil" FROM "Page" WHERE "id" = ${payment.pageId} FOR UPDATE
    `;
    const current = rows[0]?.paidUntil ?? null;
    if (options.afterRead) await options.afterRead();

    const paidUntil = extendPaidUntil({ paidUntil: current, now: options.now, plan: payment.plan });
    await tx.page.update({ where: { id: payment.pageId }, data: { paidUntil } });
    await tx.payment.update({ where: { id: payment.id }, data: { grantedUntil: paidUntil } });
    return { kind: 'granted', paidUntil };
  });
}

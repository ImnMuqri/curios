import { extendPaidUntil } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { ChipPurchase } from './client.js';

/**
 * A purchase as a grant needs it. Always one we fetched from CHIP ourselves -- after a
 * callback, a webhook or the owner's return, by the hourly check, or as a renewal charge's
 * answer -- never a message's own body, which only names the purchase.
 */
export interface PaymentEvidence {
  /** The CHIP purchase id; how the payment is found. */
  providerRef: string;
  paid: boolean;
  amountCents: number;
  /** The purchase's reference: the id of the payment we raised it for. */
  reference: string;
  /** Only when CHIP kept the card for charging again. `token` is the purchase id. */
  card: { token: string; label: string | null } | null;
}

export type GrantOutcome =
  | { kind: 'granted'; paidUntil: Date; cardSaved: boolean }
  | { kind: 'already-granted' }
  /**
   * CHIP says paid, but the payment was already marked FAILED or EXPIRED: money was taken
   * and no time was given. Nothing here can put that right on its own, so callers log it
   * at error level for a person to settle.
   */
  | { kind: 'paid-after-failure' }
  | { kind: 'not-paid' }
  | { kind: 'unknown-payment' }
  | { kind: 'mismatch'; reason: 'amount' | 'reference' };

export interface GrantOptions {
  now: Date;
  /**
   * Test-only. Runs inside the transaction, after paidUntil has been read under the
   * lock and before it is written, so a test can hold that window open and prove the
   * lock is what stops a second payment reading a stale paidUntil.
   */
  afterRead?: () => Promise<void>;
}

const CARD_NAMES: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', maestro: 'Maestro' };

/** "Visa ending 1111": enough for an owner to know which card is kept, never the number. */
function cardLabel(method: string | null, maskedPan: string | null): string | null {
  const name = method ? CARD_NAMES[method.toLowerCase()] : undefined;
  const lastFour = maskedPan?.slice(-4);
  if (!name || !lastFour || !/^\d{4}$/.test(lastFour)) return null;
  return `${name} ending ${lastFour}`;
}

export function evidenceFromPurchase(purchase: ChipPurchase): PaymentEvidence {
  return {
    providerRef: purchase.id,
    paid: purchase.status === 'paid',
    amountCents: purchase.totalCents,
    reference: purchase.reference,
    card: purchase.isRecurringToken
      ? { token: purchase.id, label: cardLabel(purchase.paymentMethod, purchase.maskedPan) }
      : null,
  };
}

/**
 * The one step that turns a paid purchase into paid time. The webhook, the redirect, the
 * hourly check and the renewal job all come here, and nothing else writes Page.paidUntil.
 *
 * Binding first: the purchase must be one we created, found by its unique id; for the
 * amount we stored; and referencing this payment. Then one transaction. The payment is
 * claimed with a conditional update, so a second arrival of the same purchase changes
 * nothing. The page row is locked, so a second payment for the same page waits and reads
 * this one's result instead of the old paidUntil. Then extend, write, and -- in the same
 * transaction, so paid time never lands without the card it was paid with -- keep the card.
 */
export async function grantPayment(
  prisma: PrismaClient,
  evidence: PaymentEvidence,
  options: GrantOptions,
): Promise<GrantOutcome> {
  if (!evidence.paid) return { kind: 'not-paid' };

  const payment = await prisma.payment.findUnique({
    where: { providerRef: evidence.providerRef },
    select: {
      id: true,
      pageId: true,
      plan: true,
      amountCents: true,
      autoRenew: true,
      autoRenewal: true,
      status: true,
    },
  });
  if (!payment) return { kind: 'unknown-payment' };
  if (payment.amountCents !== evidence.amountCents) return { kind: 'mismatch', reason: 'amount' };
  if (evidence.reference !== payment.id) return { kind: 'mismatch', reason: 'reference' };
  if (payment.status === 'PAID') return { kind: 'already-granted' };
  if (payment.status === 'FAILED' || payment.status === 'EXPIRED') return { kind: 'paid-after-failure' };

  return prisma.$transaction(async (tx): Promise<GrantOutcome> => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: options.now },
    });
    if (claimed.count === 0) {
      // Something settled it since the read above: a grant, or a failure that is now wrong.
      const settled = await tx.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
      return settled?.status === 'PAID' ? { kind: 'already-granted' } : { kind: 'paid-after-failure' };
    }

    const rows = await tx.$queryRaw<{ paidUntil: Date | null }[]>`
      SELECT "paidUntil" FROM "Page" WHERE "id" = ${payment.pageId} FOR UPDATE
    `;
    const current = rows[0]?.paidUntil ?? null;
    if (options.afterRead) await options.afterRead();

    const paidUntil = extendPaidUntil({ paidUntil: current, now: options.now, plan: payment.plan });
    await tx.page.update({ where: { id: payment.pageId }, data: { paidUntil } });
    await tx.payment.update({ where: { id: payment.id }, data: { grantedUntil: paidUntil } });

    // Asked for auto-renew and CHIP kept the card: one card per page, so a new one
    // replaces the old. Asked but no token (CHIP did not keep it) leaves renewal off.
    let cardSaved = false;
    if (payment.autoRenew && evidence.card) {
      const card = {
        token: evidence.card.token,
        plan: payment.plan,
        cardLabel: evidence.card.label,
        failedAttempts: 0,
        lastFailedAt: null,
      };
      await tx.renewalCard.upsert({
        where: { pageId: payment.pageId },
        create: { pageId: payment.pageId, ...card },
        update: card,
      });
      cardSaved = true;
    }
    // A renewal that worked ends the run of failures. updateMany, so a card the owner
    // turned off meanwhile is not an error.
    if (payment.autoRenewal) {
      await tx.renewalCard.updateMany({
        where: { pageId: payment.pageId },
        data: { failedAttempts: 0, lastFailedAt: null },
      });
    }
    return { kind: 'granted', paidUntil, cardSaved };
  });
}

export type RenewalFailureResult =
  | { kind: 'retry'; attempts: number }
  /** `attempts`: the third failure. `lapsed`: the plan ran out more than 3 days ago, after any number. */
  | { kind: 'stopped'; reason: 'attempts' | 'lapsed' }
  | { kind: 'ignored' };

const MAX_RENEWAL_ATTEMPTS = 3;
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A renewal charge failed. Claims the payment PENDING -> FAILED so a repeat report counts
 * once, then counts the failure against the page's card. The card is dropped -- auto-renew
 * off -- at the third failure, or once the paid time ran out more than 3 days ago: past
 * that the page is already offline and further charges only annoy the owner. All in one
 * transaction, so a crash cannot count a failure without failing its payment.
 *
 * Only a renewal is counted: a failed checkout is the owner's to retry, and is not claimed.
 * The card row is locked while it is counted, so two failures at once count two, and an
 * owner turning auto-renew off meanwhile either waits for this or has already won -- the
 * writes go by pageId with deleteMany/updateMany, so a card gone mid-way is never an error.
 */
export async function recordRenewalFailure(
  prisma: PrismaClient,
  paymentId: string,
  now: Date,
): Promise<RenewalFailureResult> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { pageId: true, autoRenewal: true },
    });
    if (!payment?.autoRenewal) return { kind: 'ignored' as const };

    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    if (claimed.count === 0) return { kind: 'ignored' as const };

    const cards = await tx.$queryRaw<{ failedAttempts: number }[]>`
      SELECT "failedAttempts" FROM "RenewalCard" WHERE "pageId" = ${payment.pageId} FOR UPDATE
    `;
    const card = cards[0];
    // Auto-renew is already off; there is nothing to count and no one to tell.
    if (!card) return { kind: 'ignored' as const };

    const page = await tx.page.findUniqueOrThrow({
      where: { id: payment.pageId },
      select: { paidUntil: true },
    });
    const attempts = card.failedAttempts + 1;
    const lapsed = page.paidUntil !== null && page.paidUntil.getTime() < now.getTime() - GRACE_MS;
    if (attempts >= MAX_RENEWAL_ATTEMPTS || lapsed) {
      await tx.renewalCard.deleteMany({ where: { pageId: payment.pageId } });
      return { kind: 'stopped' as const, reason: attempts >= MAX_RENEWAL_ATTEMPTS ? ('attempts' as const) : ('lapsed' as const) };
    }
    await tx.renewalCard.updateMany({
      where: { pageId: payment.pageId },
      data: { failedAttempts: attempts, lastFailedAt: now },
    });
    return { kind: 'retry' as const, attempts };
  });
}

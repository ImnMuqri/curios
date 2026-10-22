import { PLAN_PRICES_CENTS, type BillingPlan } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { ChipClient } from '@curios/billing';
import { NoPageError } from '../pages/page.service.js';

export class NotABusinessPageError extends Error {
  readonly statusCode = 400;
  readonly code = 'NOT_A_BUSINESS_PAGE';
  constructor() {
    super('Only business pages have a paid plan. Personal pages are free.');
    this.name = 'NotABusinessPageError';
  }
}

export class TrialResetUsedError extends Error {
  readonly statusCode = 409;
  readonly code = 'TRIAL_RESET_USED';
  constructor() {
    super(
      'The free trial can be reset once, and only for a page that has never paid. Pay for a month to keep capturing leads.',
    );
    this.name = 'TrialResetUsedError';
  }
}

/**
 * CHIP's product name. It has no documented short cap, but a long shop name must still
 * not fail the purchase, so the line is cut at 200 characters.
 */
export function billDescription(plan: BillingPlan, displayName: string): string {
  return `Curios Business, ${plan === 'ANNUAL' ? '1 year' : '1 month'} — ${displayName}`.slice(0, 200);
}

/** An unpaid purchase stops being payable this long after it was started. */
const PURCHASE_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Starts a payment for the signed-in owner's page.
 *
 * The Payment row is created before CHIP is called, so its id can be the purchase's
 * reference -- the field a fetched purchase is later checked against. If CHIP fails,
 * that row stays PENDING with no providerRef, which is harmless: no purchase can ever
 * match it, and the hourly check skips rows without one.
 */
export async function createPurchaseForOwner(
  deps: {
    prisma: PrismaClient;
    client: ChipClient;
    /** The API's public origin, without a trailing slash: where CHIP calls and returns to. */
    callbackBaseUrl: string;
    /** Optional, like `assignFaqSlug`'s -- `request.log` fits it without a new dependency. */
    log?: { error: (obj: unknown, msg: string) => void };
  },
  input: { accountId: string; plan: BillingPlan; autoRenew: boolean; now: Date },
): Promise<{ url: string }> {
  const page = await deps.prisma.page.findUnique({
    where: { accountId: input.accountId },
    select: { id: true, mode: true, displayName: true, account: { select: { email: true } } },
  });
  if (!page) throw new NoPageError();
  if (page.mode !== 'BUSINESS') throw new NotABusinessPageError();

  const amountCents = PLAN_PRICES_CENTS[input.plan];
  const payment = await deps.prisma.payment.create({
    data: { pageId: page.id, plan: input.plan, amountCents, provider: 'CHIP', autoRenew: input.autoRenew },
    select: { id: true },
  });

  const purchase = await deps.client.createPurchase({
    email: page.account.email,
    fullName: page.displayName.slice(0, 255),
    productName: billDescription(input.plan, page.displayName),
    amountCents,
    reference: payment.id,
    successCallback: `${deps.callbackBaseUrl}/billing/chip/callback`,
    redirectUrl: `${deps.callbackBaseUrl}/billing/chip/return?payment=${payment.id}`,
    dueAt: new Date(input.now.getTime() + PURCHASE_LIFETIME_MS),
    sendReceipt: true,
    cardsOnlyRecurring: input.autoRenew,
  });

  try {
    await deps.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: purchase.id } });
  } catch (error) {
    deps.log?.error(
      { paymentId: payment.id, purchaseId: purchase.id, err: error },
      'chip accepted the purchase but the payment row could not be updated with its id -- the purchase is now orphaned',
    );
    // Rethrown on purpose. CHIP already holds a real, payable purchase, but without this
    // update the row that could resolve it stays PENDING with providerRef null: the
    // hourly check skips rows without one, and a callback for this purchase finds no
    // match and reports unknown-payment. Nothing downstream can reconcile that on its
    // own, so the owner must not be handed a URL to a purchase this system cannot later
    // grant -- failing the request is safer than pretending it succeeded. See
    // devDocs/OPERATIONS.md.
    throw error;
  }
  return { url: purchase.checkoutUrl };
}

/**
 * Gives an owner their free trial back, once: the lead count goes to zero, and
 * the order allowance restarts from the orders placed so far (`ordersPlaced` itself
 * is never lowered; order numbers come from it).
 *
 * One conditional update, and no read before it. Two clicks a moment apart both
 * reach the database; the first matches its `where` and the second does not,
 * because the first wrote `trialResetAt`. A read-then-write would let both pass
 * the check and hand out two trials.
 *
 * The conditions are the whole policy, and each is here for its own reason:
 * BUSINESS, because a personal page never captures; `paidUntil` null, because a
 * page that has paid owes a renewal rather than a second trial -- and null is
 * what "never paid" means on this column; `trialResetAt` null, because there is
 * exactly one; and at least one lead captured or one order placed since the last baseline, because
 * resetting at zero would spend the reset on nothing and leave the owner without it when it mattered.
 *
 * Zero rows changed cannot tell us which condition failed, and deliberately does
 * not try: one message covering all of them is honest, where a read to find out
 * would reintroduce the race this avoids.
 */
export async function resetTrial(
  deps: { prisma: PrismaClient },
  input: { accountId: string; now: Date },
): Promise<void> {
  // Raw, because the order condition compares two columns, which updateMany
  // cannot say. Still the one statement: the `where` is the whole policy.
  const reset = await deps.prisma.$executeRaw`
    UPDATE "Page"
    SET "leadsCaptured" = 0, "ordersAtTrialReset" = "ordersPlaced", "trialResetAt" = ${input.now}
    WHERE "accountId" = ${input.accountId}
      AND "mode" = 'BUSINESS'
      AND "paidUntil" IS NULL
      AND "trialResetAt" IS NULL
      AND ("leadsCaptured" >= 1 OR "ordersPlaced" > "ordersAtTrialReset")`;

  if (reset === 0) throw new TrialResetUsedError();
}

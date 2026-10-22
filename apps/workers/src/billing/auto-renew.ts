import { PLAN_PRICES_CENTS } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import {
  billDescription,
  evidenceFromPurchase,
  grantPayment,
  notifyCardRemoved,
  notifyRenewalFailure,
  recordRenewalFailure,
  DEAD_PURCHASE_STATUSES,
  type ChipClient,
  type GrantOutcome,
} from '@curios/billing';
import type { BillingLog } from './pending-check.js';
import type { MailQueueLike } from './renewal-reminder.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A card is charged from a day before its plan ends... */
export const CHARGE_AHEAD_MS = DAY_MS;
/** ...until three days after, when recordRenewalFailure gives up on it anyway. */
export const CHARGE_GRACE_MS = 3 * DAY_MS;
/**
 * One attempt a day. Twenty hours rather than twenty-four, so a run that starts a little
 * earlier than yesterday's (a restart, a slow queue) is not a day late.
 */
export const ATTEMPT_GAP_MS = 20 * HOUR_MS;
/**
 * A renewal still pending after this has lost its webhook, or never reached CHIP: the job
 * asks CHIP itself, the way the hourly check does for checkouts.
 */
export const STUCK_RENEWAL_MS = 2 * HOUR_MS;
/** A renewal purchase that was never charged stops being payable after this. */
const PURCHASE_LIFETIME_MS = HOUR_MS;

export interface AutoRenewResult {
  charged: number;
  pending: number;
  failed: number;
  stopped: number;
}

type Deps = {
  prisma: PrismaClient;
  client: ChipClient;
  mailQueue: MailQueueLike;
  now: Date;
  appUrl: string;
  /** The API's public origin, where CHIP sends the renewal purchase's callback. */
  callbackBaseUrl: string;
  log?: BillingLog;
  /**
   * Test-only. Runs after the cards are read and before any is claimed, so a test can
   * remove a card in that window and prove the claim -- not the read -- decides.
   */
  afterRead?: () => Promise<void>;
};

/** Money taken with no time given, or a purchase that does not bind: a person has to look. */
function logGrant(log: BillingLog | undefined, pageId: string, purchaseId: string, outcome: GrantOutcome): void {
  const details = { pageId, purchaseId, outcome: outcome.kind };
  if (outcome.kind === 'granted') log?.info(details, 'renewal granted');
  else if (outcome.kind === 'already-granted') log?.info(details, 'renewal already granted');
  else log?.error(details, 'renewal paid at CHIP but not granted');
}

/**
 * Charges the saved card of every business page whose plan ends within a day, or ended
 * up to three days ago, and turns what CHIP answers into paid time, a counted failure,
 * or auto-renew switched off.
 *
 * Never two charges for one page. A page with a renewal still PENDING is not charged
 * again: CHIP may have taken that money already, so the job asks CHIP about it once it is
 * two hours old and only moves on when CHIP says it is settled. Then the day is claimed
 * with a conditional update on the card -- same page, same token, no attempt in the last
 * twenty hours -- so two runs at once charge once, and a card removed since the read is
 * never charged at all.
 *
 * Each page is its own try: one page's trouble -- CHIP briefly down, say -- must not
 * stop the rest.
 */
export async function runAutoRenewals(deps: Deps): Promise<AutoRenewResult> {
  const now = deps.now.getTime();
  const cards = await deps.prisma.renewalCard.findMany({
    where: {
      page: {
        mode: 'BUSINESS',
        paidUntil: { gt: new Date(now - CHARGE_GRACE_MS), lte: new Date(now + CHARGE_AHEAD_MS) },
      },
    },
    select: {
      pageId: true,
      token: true,
      plan: true,
      page: { select: { displayName: true, account: { select: { email: true } } } },
    },
    orderBy: { page: { paidUntil: 'asc' } },
  });
  if (deps.afterRead) await deps.afterRead();

  const result: AutoRenewResult = { charged: 0, pending: 0, failed: 0, stopped: 0 };
  for (const card of cards) {
    try {
      await renewPage(deps, card, result);
    } catch (error) {
      deps.log?.error({ pageId: card.pageId, err: String(error) }, 'auto-renew could not finish a page');
    }
  }
  return result;
}

type Card = {
  pageId: string;
  token: string;
  plan: 'MONTHLY' | 'ANNUAL';
  page: { displayName: string; account: { email: string } };
};

const mailDeps = (deps: Deps) => ({
  prisma: deps.prisma,
  mailQueue: deps.mailQueue,
  appUrl: deps.appUrl,
  now: deps.now,
  log: deps.log,
});

/** Counts a failure against the card and tells the owner what it means. */
async function failRenewal(deps: Deps, pageId: string, paymentId: string, result: AutoRenewResult): Promise<boolean> {
  const failure = await recordRenewalFailure(deps.prisma, paymentId, deps.now);
  if (failure.kind === 'retry') result.failed += 1;
  if (failure.kind === 'stopped') result.stopped += 1;
  deps.log?.info({ pageId, paymentId, outcome: `renewal-${failure.kind}` }, 'renewal charge failed');
  await notifyRenewalFailure(mailDeps(deps), pageId, failure);
  return failure.kind !== 'stopped';
}

/**
 * Settles renewals an earlier run left PENDING. True when the page may be charged now:
 * nothing is pending, or everything pending is settled and auto-renew is still on.
 */
async function settlePending(deps: Deps, pageId: string, result: AutoRenewResult): Promise<boolean> {
  const pending = await deps.prisma.payment.findMany({
    where: { pageId, autoRenewal: true, status: 'PENDING' },
    select: { id: true, providerRef: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const payment of pending) {
    // Young enough that its webhook may simply not have arrived yet.
    if (payment.createdAt.getTime() > deps.now.getTime() - STUCK_RENEWAL_MS) return false;

    if (!payment.providerRef) {
      // CHIP never answered the create, so there is no purchase that could have been
      // charged. Conditional, so a row settled since the read is never overwritten.
      await deps.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      continue;
    }

    const purchase = await deps.client.getPurchase(payment.providerRef);
    if (purchase.status === 'paid') {
      const outcome = await grantPayment(deps.prisma, evidenceFromPurchase(purchase), { now: deps.now });
      logGrant(deps.log, pageId, payment.providerRef, outcome);
      if (outcome.kind === 'granted') result.charged += 1;
      // Renewed, or a payment a person has to look at: either way, no second charge today.
      return false;
    }
    if (DEAD_PURCHASE_STATUSES.has(purchase.status)) {
      if (!(await failRenewal(deps, pageId, payment.id, result))) return false;
      continue;
    }
    // Still open at CHIP (pending_charge, say): it may yet be paid, so wait for it.
    return false;
  }
  return true;
}

async function renewPage(deps: Deps, card: Card, result: AutoRenewResult): Promise<void> {
  // A CHIP outage here throws to the caller's catch, which leaves the page for tomorrow.
  if (!(await settlePending(deps, card.pageId, result))) return;

  // The claim, and the only guard against charging twice in a day.
  const claim = await deps.prisma.renewalCard.updateMany({
    where: {
      pageId: card.pageId,
      token: card.token,
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(deps.now.getTime() - ATTEMPT_GAP_MS) } }],
    },
    data: { lastAttemptAt: deps.now },
  });
  if (claim.count === 0) return;

  // The row first, so its id can be the purchase's reference. If CHIP fails the create,
  // the row stays PENDING with no providerRef: nothing can be charged against it, and a
  // later run marks it EXPIRED and tries again.
  const amountCents = PLAN_PRICES_CENTS[card.plan];
  const payment = await deps.prisma.payment.create({
    data: { pageId: card.pageId, plan: card.plan, amountCents, provider: 'CHIP', autoRenewal: true },
    select: { id: true },
  });
  const purchase = await deps.client.createPurchase({
    email: card.page.account.email,
    fullName: card.page.displayName.slice(0, 255),
    productName: billDescription(card.plan, card.page.displayName),
    amountCents,
    reference: payment.id,
    successCallback: `${deps.callbackBaseUrl.replace(/\/+$/, '')}/billing/chip/callback`,
    dueAt: new Date(deps.now.getTime() + PURCHASE_LIFETIME_MS),
    sendReceipt: true,
    cardsOnlyRecurring: false,
  });
  await deps.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: purchase.id } });

  let charge;
  try {
    charge = await deps.client.chargePurchase(purchase.id, card.token);
  } catch (error) {
    // CHIP down, or an answer we do not understand: the card may have been charged all
    // the same. The payment stays PENDING and the day stays claimed; a later run asks
    // CHIP what happened before it ever charges again.
    result.pending += 1;
    deps.log?.error({ pageId: card.pageId, purchaseId: purchase.id, err: String(error) }, 'renewal charge unconfirmed');
    return;
  }

  if (charge.kind === 'paid') {
    const outcome = await grantPayment(deps.prisma, evidenceFromPurchase(charge.purchase), { now: deps.now });
    logGrant(deps.log, card.pageId, purchase.id, outcome);
    if (outcome.kind === 'granted') result.charged += 1;
    return;
  }
  if (charge.kind === 'pending') {
    // A slow acquirer: the webhook settles it, or a later run asks CHIP.
    result.pending += 1;
    deps.log?.info({ pageId: card.pageId, purchaseId: purchase.id }, 'renewal charge pending at CHIP');
    return;
  }
  if (charge.kind === 'declined') {
    await failRenewal(deps, card.pageId, payment.id, result);
    return;
  }

  // invalid-token: CHIP no longer knows the card, so no charge can ever work. By page and
  // token, so a card the owner replaced meanwhile is left alone.
  const removed = await deps.prisma.renewalCard.deleteMany({ where: { pageId: card.pageId, token: card.token } });
  await deps.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
  deps.log?.info({ pageId: card.pageId, purchaseId: purchase.id }, 'renewal card no longer valid; auto-renew off');
  if (removed.count > 0) {
    result.stopped += 1;
    await notifyCardRemoved(mailDeps(deps), card.pageId);
  }
}

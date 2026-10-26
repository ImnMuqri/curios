import { PLAN_PRICES_CENTS } from '@curios/core';
import { malaysiaToday } from '@curios/core/orders';
import type { Settings } from '@curios/core/settings';
import type { PrismaClient } from '@curios/db';
import {
  billDescription,
  evidenceFromPurchase,
  grantPayment,
  notifyAutoRenewStopped,
  notifyCardRemoved,
  notifyRenewalFailure,
  recordRenewalFailure,
  DEAD_PURCHASE_STATUSES,
  PAID_PURCHASE_STATUSES,
  type ChipClient,
  type GrantOutcome,
  type RenewalFailureResult,
} from '@curios/billing';
import type { BillingLog } from './pending-check.js';
import type { MailQueueLike } from './renewal-reminder.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A card is charged on the Kuala Lumpur calendar day its plan ends -- the date Billing and
 * the emails state -- at that day's 10:00 run, whatever the hour the plan ends: a plan
 * ending at 23:00 is renewed that morning, one that ended at 09:00 an hour into its
 * grace. Never the day before. Charging is allowed until three days after, when
 * recordRenewalFailure gives up on it anyway.
 */
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

/**
 * What an error may say in a log: its name, and nothing else. A refused CHIP call carries
 * CHIP's response body in its message, and that body can hold the payer's details.
 */
export const errName = (error: unknown) => (error instanceof Error ? error.name : 'unknown');

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
  /** The admin's settings in force for this run. With CHIP payments off the run is skipped. */
  settings: Settings;
  /**
   * Test-only. Runs after the cards are read and before any is claimed, so a test can
   * change a card or its page in that window and prove the claim -- not the read -- decides.
   */
  afterRead?: () => Promise<void>;
  /**
   * Test-only. Runs after the lapsed cards are read and before any is dropped, so a test
   * can renew a page in that window and prove the drop checks the plan again.
   */
  afterLapsedRead?: () => Promise<void>;
  /**
   * Test-only. Runs after the purchase is created and before the card is charged, so a
   * test can turn auto-renew off in that window and prove the card is checked again.
   */
  beforeCharge?: () => Promise<void>;
};

/** Money taken with no time given, or a purchase that does not bind: a person has to look. */
function logGrant(log: BillingLog | undefined, pageId: string, purchaseId: string, outcome: GrantOutcome): void {
  const details = { pageId, purchaseId, outcome: outcome.kind };
  if (outcome.kind === 'granted') log?.info(details, 'renewal granted');
  else if (outcome.kind === 'already-granted') log?.info(details, 'renewal already granted');
  else log?.error(details, 'renewal paid at CHIP but not granted');
}

/**
 * Charges the saved card of every business page whose plan ends today in Kuala Lumpur,
 * or ended up to three days ago, and turns what CHIP answers into paid time, a counted failure,
 * or auto-renew switched off. Then drops the cards whose plan ran out past that grace
 * with no renewal through, telling each owner, so no plan ends in silence.
 *
 * Never two charges for one page. A page with a renewal still PENDING is not charged
 * again: CHIP may have taken that money already, so the job asks CHIP about it once it is
 * two hours old and only moves on when CHIP says it is settled. Then the day is claimed
 * with a conditional update on the card -- same page, same token, plan still in the window,
 * no attempt in the last twenty hours -- so two runs at once charge once, and a card
 * removed or a plan paid since the read is never charged. The card is checked once more
 * just before the charge, for an owner who turned auto-renew off in between.
 *
 * At most one email per page per run, decided once today's attempt is known.
 *
 * Each page is its own try: one page's trouble -- CHIP briefly down, say -- must not
 * stop the rest.
 *
 * A suspended page is paused: never charged, and its card is never dropped for lapsing
 * while it is suspended. Brought back, it is charged on the next run if its plan is still
 * in the window, or its card goes the usual way if the plan ran out past the grace.
 *
 * While the admin has CHIP payments switched off the whole run is skipped: nothing is
 * charged, settled or dropped, and nobody is mailed. The next day's run tries again, inside
 * the same three days' grace.
 */
export async function runAutoRenewals(deps: Deps): Promise<AutoRenewResult> {
  if (!deps.settings.switches.chipPayments) {
    deps.log?.info({}, 'auto-renew skipped: CHIP payments are off');
    return { charged: 0, pending: 0, failed: 0, stopped: 0 };
  }
  const cards = await deps.prisma.renewalCard.findMany({
    where: { page: { mode: 'BUSINESS', paidUntil: chargeWindow(deps.now), suspendedAt: null } },
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
    // A failure counted while settling an earlier renewal, told only if today brings no
    // fresh attempt that answers it (see renewPage).
    const page: PageRun = { untold: null };
    try {
      await renewPage(deps, card, result, page);
    } catch (error) {
      deps.log?.error({ pageId: card.pageId, err: errName(error) }, 'auto-renew could not finish a page');
    }
    if (page.untold) await notifyRenewalFailure(mailDeps(deps), card.pageId, page.untold);
  }

  await dropLapsedCards(deps, result);
  return result;
}

/** paidUntil from three days ago (exclusive) to the end of today in Kuala Lumpur (inclusive). */
function chargeWindow(now: Date) {
  // Malaysia keeps UTC+8 all year, with no daylight saving.
  const tomorrow = new Date(Date.parse(`${malaysiaToday(now)}T00:00:00+08:00`) + DAY_MS);
  return { gt: new Date(now.getTime() - CHARGE_GRACE_MS), lt: tomorrow };
}

type Card = {
  pageId: string;
  token: string;
  plan: 'MONTHLY' | 'ANNUAL';
  page: { displayName: string; account: { email: string } };
};

type PageRun = { untold: RenewalFailureResult | null };

const mailDeps = (deps: Deps) => ({
  prisma: deps.prisma,
  mailQueue: deps.mailQueue,
  appUrl: deps.appUrl,
  now: deps.now,
  log: deps.log,
});

/** Counts a failure against the card. The caller decides whether and when to tell the owner. */
async function countFailure(
  deps: Deps,
  pageId: string,
  paymentId: string,
  result: AutoRenewResult,
): Promise<RenewalFailureResult> {
  const failure = await recordRenewalFailure(deps.prisma, paymentId, deps.now);
  if (failure.kind === 'retry') result.failed += 1;
  if (failure.kind === 'stopped') result.stopped += 1;
  deps.log?.info({ pageId, paymentId, outcome: `renewal-${failure.kind}` }, 'renewal charge failed');
  return failure;
}

/**
 * Settles renewals an earlier run left PENDING. True when the page may be charged now:
 * nothing is pending, or everything pending is settled and auto-renew is still on.
 *
 * A dead renewal is counted here but not told: if today's fresh charge renews the plan
 * there is nothing to tell, and if it is declined that mail carries the final count. It
 * is left in `page.untold` for when no fresh charge follows. A failure that stops
 * auto-renew is told at once, since nothing follows it.
 */
async function settlePending(deps: Deps, pageId: string, result: AutoRenewResult, page: PageRun): Promise<boolean> {
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
    if (PAID_PURCHASE_STATUSES.has(purchase.status)) {
      const outcome = await grantPayment(deps.prisma, evidenceFromPurchase(purchase), { now: deps.now });
      logGrant(deps.log, pageId, payment.providerRef, outcome);
      if (outcome.kind === 'granted') result.charged += 1;
      // Renewed, or a payment a person has to look at: either way, no second charge today.
      return false;
    }
    if (DEAD_PURCHASE_STATUSES.has(purchase.status)) {
      const failure = await countFailure(deps, pageId, payment.id, result);
      if (failure.kind === 'stopped') {
        page.untold = null;
        await notifyRenewalFailure(mailDeps(deps), pageId, failure);
        return false;
      }
      if (failure.kind === 'retry') page.untold = failure;
      continue;
    }
    // Still open at CHIP (pending_charge, say): it may yet be paid, so wait for it.
    return false;
  }
  return true;
}

async function renewPage(deps: Deps, card: Card, result: AutoRenewResult, page: PageRun): Promise<void> {
  // A CHIP outage here throws to the caller's catch, which leaves the page for tomorrow.
  if (!(await settlePending(deps, card.pageId, result, page))) return;

  // The claim, and the only guard against charging twice in a day. The window is checked
  // again here, so a plan paid at checkout since the read is not renewed on top.
  const claim = await deps.prisma.renewalCard.updateMany({
    where: {
      pageId: card.pageId,
      token: card.token,
      page: { paidUntil: chargeWindow(deps.now), suspendedAt: null },
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
  if (deps.beforeCharge) await deps.beforeCharge();

  // The owner may have turned auto-renew off, or saved another card, since the claim.
  // Checked as late as it can be; what remains is the moment between this read and
  // CHIP receiving the charge.
  if ((await deps.prisma.renewalCard.count({ where: { pageId: card.pageId, token: card.token } })) === 0) {
    await deps.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    try {
      await deps.client.cancelPurchase(purchase.id);
    } catch (error) {
      // Unpaid and due in an hour: it expires on its own.
      deps.log?.error({ pageId: card.pageId, purchaseId: purchase.id, err: errName(error) }, 'unused renewal purchase not cancelled');
    }
    deps.log?.info({ pageId: card.pageId, purchaseId: purchase.id }, 'auto-renew turned off before the charge');
    return;
  }

  // From here today's attempt answers any failure counted while settling: its own outcome
  // is what the owner hears, if anything.
  page.untold = null;
  let charge;
  try {
    charge = await deps.client.chargePurchase(purchase.id, card.token);
  } catch (error) {
    // CHIP down, or an answer we do not understand: the card may have been charged all
    // the same. The payment stays PENDING and the day stays claimed; a later run asks
    // CHIP what happened before it ever charges again.
    result.pending += 1;
    deps.log?.error({ pageId: card.pageId, purchaseId: purchase.id, err: errName(error) }, 'renewal charge unconfirmed');
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
    const failure = await countFailure(deps, card.pageId, payment.id, result);
    await notifyRenewalFailure(mailDeps(deps), card.pageId, failure);
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

/**
 * Cards whose plan ran out more than the grace ago with no renewal through -- CHIP
 * unreachable, or a charge left open, every day of the window. The page is already
 * offline and the plan-ended email skips pages with a card, so without this the plan
 * would end in silence. Each card goes by page and token, and its owner is told once;
 * a renewal still PENDING is left for its webhook, which can still grant it. The plan is
 * checked again in the delete, so a page that webhook renewed since the read keeps its card.
 */
async function dropLapsedCards(deps: Deps, result: AutoRenewResult): Promise<void> {
  const lapsed = await deps.prisma.renewalCard.findMany({
    where: {
      page: { mode: 'BUSINESS', paidUntil: { lte: new Date(deps.now.getTime() - CHARGE_GRACE_MS) }, suspendedAt: null },
    },
    select: { pageId: true, token: true },
  });
  if (deps.afterLapsedRead) await deps.afterLapsedRead();
  for (const card of lapsed) {
    try {
      const removed = await deps.prisma.renewalCard.deleteMany({
        where: {
          pageId: card.pageId,
          token: card.token,
          page: { paidUntil: { lte: new Date(deps.now.getTime() - CHARGE_GRACE_MS) }, suspendedAt: null },
        },
      });
      if (removed.count === 0) continue;
      result.stopped += 1;
      deps.log?.info({ pageId: card.pageId }, 'plan ran out past the grace; auto-renew off');
      await notifyAutoRenewStopped(mailDeps(deps), card.pageId, 'lapsed');
    } catch (error) {
      deps.log?.error({ pageId: card.pageId, err: errName(error) }, 'lapsed renewal card could not be dropped');
    }
  }
}

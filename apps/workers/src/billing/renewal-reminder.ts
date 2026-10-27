import type { MailJobData } from '@curios/core';
import { MAIL_QUEUE, orderState, planEndedMail, planEndingMail } from '@curios/core';
import type { Settings } from '@curios/core/settings';
import type { PrismaClient } from '@curios/db';
import type { BillingLog } from './pending-check.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead an owner is warned. Three days is long enough to act on and
 * short enough that the page is still working when it arrives -- a reminder a
 * fortnight early is filed and forgotten.
 */
export const REMINDER_WINDOW_MS = 3 * DAY_MS;

/**
 * The slice of a BullMQ queue this job needs. Structurally identical to the
 * lead worker's, and deliberately declared again rather than shared: each
 * worker naming the two things it uses is clearer than a queue-shaped module
 * imported across features, and there is no logic here to keep in step.
 */
export interface MailQueueLike {
  add(name: string, data: MailJobData, opts?: unknown): Promise<{ id?: string }>;
}

/**
 * The reminder itself: planEndingMail in @curios/core, laid out as the
 * Emails board draws its emails. English, because the dashboard is; and the
 * one thing it must not do is imply an automatic charge without a saved card,
 * since an owner who believes otherwise finds out by losing their capture card.
 */
export function buildRenewalReminder(input: {
  displayName: string;
  paidUntil: Date;
  appUrl: string;
  card: { label: string | null; amountCents: number } | null;
}): { subject: string; text: string; html: string } {
  return planEndingMail(input);
}

/**
 * Warns owners whose plan ends within the window, once per period.
 *
 * Claimed first, emailed second. The claim is a conditional update writing the
 * page's own `paidUntil` into `renewalReminderFor`, so two runs at once produce
 * one email, and a crash after the claim loses that email rather than sending a
 * second tomorrow. Losing one is the gentler failure: both screens still show
 * the end date, and an owner emailed twice about the same thing stops reading.
 *
 * There is no reminders table because there does not need to be one: paying
 * moves `paidUntil`, and a page whose mark no longer equals its `paidUntil` is
 * eligible again by construction.
 */
export async function runRenewalReminders(deps: {
  prisma: PrismaClient;
  mailQueue: MailQueueLike;
  now: Date;
  appUrl: string;
  log?: BillingLog;
  /** The admin's settings: the reminder quotes the price in force. */
  settings: { get(): Promise<Settings> };
}): Promise<{ reminded: number }> {
  const { prices } = await deps.settings.get();
  const due = await deps.prisma.page.findMany({
    where: {
      mode: 'BUSINESS',
      paidUntil: { gt: deps.now, lte: new Date(deps.now.getTime() + REMINDER_WINDOW_MS) },
    },
    select: {
      id: true,
      displayName: true,
      paidUntil: true,
      renewalCard: { select: { plan: true, cardLabel: true } },
      account: { select: { email: true } },
    },
    orderBy: { paidUntil: 'asc' },
  });

  let reminded = 0;
  for (const page of due) {
    const paidUntil = page.paidUntil;
    if (paidUntil === null) continue;

    // The claim, and the only guard. There is deliberately no check of the mark
    // in front of it, so the test that proves one reminder per period is a test
    // of this update rather than of a shortcut before it. A page already
    // reminded costs one update that changes no rows, at most three days running.
    // `paidUntil` is in the `where` too, so an owner who renews between the read
    // above and this write is not marked for a period that is no longer theirs.
    // The explicit null branch is here rather than a bare `not`, so the query
    // does not depend on how NULL compares in an inequality.
    const claim = await deps.prisma.page.updateMany({
      where: {
        id: page.id,
        paidUntil,
        OR: [{ renewalReminderFor: null }, { renewalReminderFor: { not: paidUntil } }],
      },
      data: { renewalReminderFor: paidUntil },
    });
    if (claim.count === 0) continue;

    const mail = buildRenewalReminder({
      displayName: page.displayName,
      paidUntil,
      appUrl: deps.appUrl,
      // What the renewal job will charge: today's price of the plan the card was saved for. A
      // change before the charge applies to it, as the Terms say.
      card: page.renewalCard
        ? { label: page.renewalCard.cardLabel, amountCents: prices[page.renewalCard.plan] }
        : null,
    });
    try {
      await deps.mailQueue.add(MAIL_QUEUE, { to: page.account.email, ...mail, audience: 'owner' });
    } catch (error) {
      // One page's email failing -- Redis briefly unreachable, say -- must not
      // stop the rest. The claim above already stands, so this page stays
      // claimed for this period: losing one reminder is the accepted failure,
      // not losing every page still to be checked in the loop.
      deps.log?.error({ pageId: page.id, err: String(error) }, 'renewal reminder could not be queued');
      continue;
    }

    reminded += 1;
    // The page and the period, never the address: an owner's email in a log is
    // an owner's email in every log aggregator downstream of it.
    deps.log?.info({ pageId: page.id, paidUntil: paidUntil.toISOString() }, 'renewal reminder queued');
  }

  return { reminded };
}

/**
 * How long after a plan ends it may still be told so. The job runs once a
 * day, so a day and a bit covers a missed run without reaching back to a
 * plan that ended long ago (one that lapsed before this email existed).
 */
export const ENDED_WINDOW_MS = 2 * DAY_MS;

/**
 * Tells owners whose plan has just ended, once per period: the on-the-day
 * sibling of the reminder above, claimed the same way on planEndedMailFor.
 * A page that renewed in time has a later paidUntil and is never picked.
 */
export async function runPlanEndedMails(deps: {
  prisma: PrismaClient;
  mailQueue: MailQueueLike;
  now: Date;
  appUrl: string;
  log?: BillingLog;
  /** The admin's settings: the shop's free orders are counted against `freeOrders`. */
  settings: { get(): Promise<Settings> };
}): Promise<{ told: number }> {
  const { freeOrders } = await deps.settings.get();
  const ended = await deps.prisma.page.findMany({
    where: {
      mode: 'BUSINESS',
      paidUntil: { lte: deps.now, gt: new Date(deps.now.getTime() - ENDED_WINDOW_MS) },
      // A page with a card is still being renewed; the auto-renew job tells the owner if it gives up.
      renewalCard: null,
    },
    select: {
      id: true,
      displayName: true,
      paidUntil: true,
      ordersPlaced: true,
      ordersAtTrialReset: true,
      storeEnabled: true,
      account: { select: { email: true } },
    },
    orderBy: { paidUntil: 'asc' },
  });

  let told = 0;
  for (const page of ended) {
    const paidUntil = page.paidUntil;
    if (paidUntil === null) continue;

    const claim = await deps.prisma.page.updateMany({
      where: {
        id: page.id,
        paidUntil,
        OR: [{ planEndedMailFor: null }, { planEndedMailFor: { not: paidUntil } }],
      },
      data: { planEndedMailFor: paidUntil },
    });
    if (claim.count === 0) continue;

    // The shop by the rule checkout uses: free orders left keep it open.
    const shop = {
      state: orderState({ mode: 'BUSINESS', paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now: deps.now }, freeOrders),
      storeEnabled: page.storeEnabled,
    };
    const mail = planEndedMail({ displayName: page.displayName, paidUntil, appUrl: deps.appUrl, shop });
    try {
      await deps.mailQueue.add(MAIL_QUEUE, { to: page.account.email, ...mail, audience: 'owner' });
    } catch (error) {
      // As above: the claim stands, and losing one is the accepted failure.
      deps.log?.error({ pageId: page.id, err: String(error) }, 'plan-ended email could not be queued');
      continue;
    }
    told += 1;
    deps.log?.info({ pageId: page.id, paidUntil: paidUntil.toISOString() }, 'plan-ended email queued');
  }

  return { told };
}

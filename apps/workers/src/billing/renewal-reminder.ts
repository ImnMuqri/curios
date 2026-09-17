import type { MailJobData } from '@curios/core';
import { MAIL_QUEUE } from '@curios/core';
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

/** The plan's end date as an owner in Malaysia reads it. */
function malaysianDate(date: Date): string {
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * The reminder itself. Pure, like `buildNotification` in the lead worker, so the
 * wording is testable without a queue or a database.
 *
 * English, because the dashboard is: the lead notification mirrors the visitor's
 * own language because it quotes their conversation back to the owner, and this
 * email quotes nobody.
 *
 * The one thing this email must not do is imply an automatic charge. FPX cannot
 * auto-charge, so nothing will be taken -- and an owner who believes otherwise
 * finds out by losing their capture card.
 */
export function buildRenewalReminder(input: {
  displayName: string;
  paidUntil: Date;
  appUrl: string;
}): { subject: string; text: string } {
  const ends = malaysianDate(input.paidUntil);
  const billing = `${input.appUrl.replace(/\/+$/, '')}/app/billing`;

  return {
    subject: `Your Curios plan for ${input.displayName} ends on ${ends}`,
    text: [
      `Your Curios plan for ${input.displayName} ends on ${ends}.`,
      '',
      'We do not charge you automatically — FPX payments need your approval each time, so nothing will be taken from your account.',
      '',
      'To keep the capture card on your page, pay for another month or year here:',
      billing,
      '',
      'If you do nothing, your page, your FAQ pages and chat all keep working. Only the capture card stops.',
    ].join('\n'),
  };
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
}): Promise<{ reminded: number }> {
  const due = await deps.prisma.page.findMany({
    where: {
      mode: 'BUSINESS',
      paidUntil: { gt: deps.now, lte: new Date(deps.now.getTime() + REMINDER_WINDOW_MS) },
    },
    select: {
      id: true,
      displayName: true,
      paidUntil: true,
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
    });
    await deps.mailQueue.add(MAIL_QUEUE, {
      to: page.account.email,
      subject: mail.subject,
      text: mail.text,
    });

    reminded += 1;
    // The page and the period, never the address: an owner's email in a log is
    // an owner's email in every log aggregator downstream of it.
    deps.log?.info({ pageId: page.id, paidUntil: paidUntil.toISOString() }, 'renewal reminder queued');
  }

  return { reminded };
}

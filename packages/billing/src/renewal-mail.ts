import { autoRenewStoppedMail, MAIL_QUEUE, renewalFailedMail, type MailJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { RenewalFailureResult } from './grant.js';

export interface RenewalMailDeps {
  prisma: PrismaClient;
  mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  appUrl: string;
  /** Whether the mail says the plan "ends" or "ended". The clock, unless a test fixes it. */
  now?: Date;
  log?: { error: (details: object, message: string) => void };
}

type Mail = { subject: string; text: string; html: string };

/**
 * Queues one plan email to the page's owner, and never throws. The webhook calls this
 * after the failure it describes has been committed: a throw there would answer CHIP 500,
 * CHIP would send the message again, and the repeat would find the payment already FAILED
 * and mail nobody. Losing the email is the gentler failure, so it is logged instead -- by
 * the page, never the address.
 */
async function mailOwner(
  deps: RenewalMailDeps,
  pageId: string,
  build: (page: { displayName: string; paidUntil: Date }) => Mail,
): Promise<void> {
  try {
    const page = await deps.prisma.page.findUnique({
      where: { id: pageId },
      select: { displayName: true, paidUntil: true, account: { select: { email: true } } },
    });
    // A page with a renewal card has paid before; without a paidUntil there is no plan to describe.
    if (!page?.paidUntil) {
      deps.log?.error({ pageId }, 'renewal email has no paid plan to describe');
      return;
    }
    const mail = build({ displayName: page.displayName, paidUntil: page.paidUntil });
    await deps.mailQueue.add(MAIL_QUEUE, { to: page.account.email, ...mail });
  } catch (error) {
    deps.log?.error({ pageId, err: String(error) }, 'renewal email could not be queued');
  }
}

/**
 * Tells the owner what a counted renewal failure means: `retry` says the card is tried
 * again tomorrow, `stopped` says auto-renew is off. `ignored` was not counted -- a repeat,
 * or a card already turned off -- and sends nothing. Used by the renewal job and the
 * webhook alike, so the two can never word it differently.
 */
export async function notifyRenewalFailure(
  deps: RenewalMailDeps,
  pageId: string,
  result: RenewalFailureResult,
): Promise<void> {
  if (result.kind === 'ignored') return;
  const now = deps.now ?? new Date();
  await mailOwner(deps, pageId, (page) =>
    result.kind === 'retry'
      ? renewalFailedMail({ ...page, appUrl: deps.appUrl, attempts: result.attempts })
      : autoRenewStoppedMail({ ...page, appUrl: deps.appUrl, reason: result.reason, now }),
  );
}

/**
 * Auto-renew was turned off by the system, not by a counted failure: `card-removed` when
 * CHIP no longer knows the saved card, `lapsed` when the plan ran out with no renewal
 * through (CHIP unreachable, or a charge left open, for the whole grace).
 */
export async function notifyAutoRenewStopped(
  deps: RenewalMailDeps,
  pageId: string,
  reason: 'card-removed' | 'lapsed',
): Promise<void> {
  const now = deps.now ?? new Date();
  await mailOwner(deps, pageId, (page) => autoRenewStoppedMail({ ...page, appUrl: deps.appUrl, reason, now }));
}

/** The saved card can no longer be charged at all (CHIP no longer knows its token), so auto-renew is off. */
export async function notifyCardRemoved(deps: RenewalMailDeps, pageId: string): Promise<void> {
  await notifyAutoRenewStopped(deps, pageId, 'card-removed');
}

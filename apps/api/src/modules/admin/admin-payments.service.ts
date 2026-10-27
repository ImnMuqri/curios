import { ADMIN_ACTIONS } from '@curios/core';
import { attemptOutcome, handleChipMessage, type ChipMessageDeps, type ChipSource } from '../billing/chip-message.js';
import type { AdminActor } from './admin-pages.service.js';
import { writeAudit } from './audit.js';

export class WebhookNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'WEBHOOK_NOT_FOUND';

  constructor() {
    super('That payment message is not in the log.');
    this.name = 'WebhookNotFoundError';
  }
}

/**
 * Runs a logged CHIP message through the handler again: the body as it was stored, from the
 * source it came from. Its signature passed when it was logged, and is not checked again --
 * nothing in the body is believed anyway: the handler fetches the purchase from CHIP by its
 * id and grants from CHIP's answer, once per purchase. So replaying a purchase that has
 * since been granted answers already-granted and moves nothing.
 *
 * The replay counts as an attempt on the row, as a resend from CHIP does. The row's update
 * and the audit row go in one transaction after the handler has run -- the handler commits
 * its own work (a grant locks the page in a transaction of its own) -- and both are written
 * whether it worked or not, so a replay that failed again is on the record too. Its error is
 * then thrown, and the admin sees it.
 */
export async function replayWebhook(
  deps: ChipMessageDeps,
  actor: AdminActor,
  id: string,
  reason: string,
): Promise<{ status: string }> {
  const event = await deps.prisma.chipWebhookEvent.findUnique({
    where: { id },
    select: { id: true, source: true, eventType: true, purchaseId: true, body: true },
  });
  if (!event) throw new WebhookNotFoundError();

  let result: { status: string } | null = null;
  let failure: { error: unknown } | null = null;
  try {
    result = await handleChipMessage(deps, { source: event.source as ChipSource, body: JSON.parse(event.body) as unknown });
  } catch (error) {
    failure = { error };
  }

  // Read after the handler, so the label is the page as it is now.
  const payment = await deps.prisma.payment.findUnique({
    where: { providerRef: event.purchaseId },
    select: { id: true, pageHandle: true, page: { select: { handle: true } } },
  });
  const attempt = attemptOutcome(failure);
  await deps.prisma.$transaction(async (tx) => {
    await tx.chipWebhookEvent.update({
      where: { id: event.id },
      data: { ...attempt, attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    await writeAudit(tx, {
      adminUserId: actor.adminId,
      action: ADMIN_ACTIONS.REPLAYED_WEBHOOK,
      targetType: 'Payment',
      targetId: payment?.id ?? event.purchaseId,
      targetLabel: payment?.page?.handle ?? payment?.pageHandle ?? event.purchaseId,
      reason,
      metadata: {
        eventId: event.id,
        source: event.source,
        eventType: event.eventType,
        purchaseId: event.purchaseId,
        outcome: attempt.outcome,
        ...(result ? { status: result.status } : { error: attempt.error }),
      },
      ip: actor.ip,
    });
  });

  if (failure) throw failure.error;
  return result!;
}

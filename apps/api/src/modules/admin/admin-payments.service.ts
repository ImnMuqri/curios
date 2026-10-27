import { ADMIN_ACTIONS } from '@curios/core';
import { errName } from '../billing/billing.service.js';
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

/** A logged row whose source is neither of CHIP's two messages: nothing knows how to run it. */
export class WebhookSourceError extends Error {
  readonly statusCode = 409;
  readonly code = 'WEBHOOK_SOURCE';

  constructor() {
    super('That payment message came from somewhere it cannot be replayed from.');
    this.name = 'WebhookSourceError';
  }
}

const isChipSource = (source: string): source is ChipSource => source === 'callback' || source === 'webhook';

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
 * then thrown, and the admin sees it -- also when the record could not be written: the
 * handler's error says what happened to the payment, so it is the one answered, and both are
 * logged.
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
  const source = event.source;
  if (!isChipSource(source)) throw new WebhookSourceError();

  let result: { status: string } | null = null;
  let failure: { error: unknown } | null = null;
  try {
    result = await handleChipMessage(deps, { source, body: JSON.parse(event.body) as unknown });
  } catch (error) {
    failure = { error };
  }

  const attempt = attemptOutcome(failure);
  let payment: { id: string; pageHandle: string | null; page: { handle: string } | null } | null = null;
  // The grant cannot share this transaction: the handler asks CHIP about the purchase over
  // the network first, and a transaction is not held open across that (DEVIATIONS 229). So
  // a grant can commit and this record then fail; when it does, the ids say which one (names
  // only, nothing of the payer's), and the admin sees the error rather than a success with
  // nothing on the record.
  try {
    // Read after the handler, so the label is the page as it is now.
    payment = await deps.prisma.payment.findUnique({
      where: { providerRef: event.purchaseId },
      select: { id: true, pageHandle: true, page: { select: { handle: true } } },
    });
    const target = payment;
    await deps.prisma.$transaction(async (tx) => {
      await tx.chipWebhookEvent.update({
        where: { id: event.id },
        data: { ...attempt, attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      await writeAudit(tx, {
        adminUserId: actor.adminId,
        action: ADMIN_ACTIONS.REPLAYED_WEBHOOK,
        targetType: 'Payment',
        targetId: target?.id ?? event.purchaseId,
        targetLabel: target?.page?.handle ?? target?.pageHandle ?? event.purchaseId,
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
  } catch (error) {
    deps.log.error(
      {
        eventId: event.id,
        purchaseId: event.purchaseId,
        paymentId: payment?.id ?? null,
        handled: !failure,
        err: errName(error),
        ...(failure ? { handlerErr: errName(failure.error) } : {}),
      },
      'webhook replayed, but the attempt and its audit row could not be written',
    );
    // A handler error must not be masked by the record's: it is what the admin needs to see.
    throw failure ? failure.error : error;
  }

  if (failure) throw failure.error;
  return result!;
}

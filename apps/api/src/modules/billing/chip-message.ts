import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  evidenceFromPurchase,
  grantPayment,
  notifyRenewalFailure,
  recordRenewalFailure,
  type ChipClient,
  type GrantOutcome,
  type RenewalFailureResult,
} from '@curios/billing';
import type { PrismaClient } from '@curios/db';
import { errName } from './billing.service.js';
import { statusFor } from '../../plugins/errors.js';

/** Which of CHIP's two server-to-server messages it was. Each is signed with its own key. */
export type ChipSource = 'callback' | 'webhook';

export interface ChipMessageDeps {
  prisma: PrismaClient;
  client: ChipClient;
  /**
   * Told when a renewal charge failed and was counted, so the owner can be mailed. Never
   * throws (notifyRenewalFailure does not), so a mail queue that is down cannot turn a
   * recorded failure into a 500 and a resend.
   */
  onRenewalFailure: (pageId: string, result: RenewalFailureResult) => Promise<void>;
  log: FastifyBaseLogger;
}

/** Everything the handler needs but the request's own log: built once, in app.ts. */
export type ChipMessages = Omit<ChipMessageDeps, 'log'>;

/**
 * The handler's dependencies, built once and shared: CHIP's routes run each signed message
 * through it, and the admin's replay runs a logged one through the same client. Without an
 * injected hook, a counted renewal failure mails the owner through the app's mail queue.
 */
export function chipMessagesFor(
  app: FastifyInstance,
  client: ChipClient,
  onRenewalFailure?: ChipMessageDeps['onRenewalFailure'],
): ChipMessages {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  return {
    prisma: app.prisma,
    client,
    onRenewalFailure:
      onRenewalFailure ??
      ((pageId, result) =>
        notifyRenewalFailure({ prisma: app.prisma, mailQueue: app.mailQueue, appUrl, log: app.log }, pageId, result)),
  };
}

/**
 * The purchase id and the outcome, and nothing else. A purchase carries the payer's
 * email and name, and logging them on the way past is how they end up somewhere they
 * were never meant to be.
 */
export function logOutcome(
  log: FastifyBaseLogger,
  purchaseId: string | undefined,
  source: 'return' | ChipSource,
  outcome: GrantOutcome,
): void {
  const details = {
    purchaseId,
    source,
    outcome: outcome.kind,
    ...(outcome.kind === 'mismatch' ? { reason: outcome.reason } : {}),
  };
  if (outcome.kind === 'paid-after-failure') {
    // Money taken with no time given: a person has to settle this one.
    log.error(details, 'chip purchase paid after its payment was marked failed or expired');
  } else if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-payment' || outcome.kind === 'test-purchase') {
    log.error(details, 'chip purchase refused');
  } else {
    log.info(details, 'chip purchase handled');
  }
}

const bodyId = (body: unknown): string | undefined => {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(body);
  return parsed.success ? parsed.data.id : undefined;
};

/** CHIP's event_type, which both kinds of message carry; 'unknown' for one that has none. */
const eventTypeOf = (body: unknown): string => {
  const event = (body as { event_type?: unknown } | null | undefined)?.event_type;
  return typeof event === 'string' && event.trim() !== '' ? event : 'unknown';
};

/**
 * A signed message names a purchase, and nothing else in it is believed: the purchase is
 * fetched from CHIP by that id, and the grant is made from what CHIP says.
 */
async function grantFromChip(deps: ChipMessageDeps, purchaseId: string, source: ChipSource) {
  const purchase = await deps.client.getPurchase(purchaseId);
  const outcome = await grantPayment(deps.prisma, evidenceFromPurchase(purchase), { now: new Date() });
  logOutcome(deps.log, purchaseId, source, outcome);
  return { status: outcome.kind };
}

/**
 * What CHIP's callback and webhook do once the signature has passed -- or once the admin
 * replays a message whose signature passed when it was logged. Every grant is made from
 * CHIP's own answer and is idempotent on the purchase id, so running a message twice
 * grants at most once: a replay of a purchase already granted answers already-granted.
 *
 * A failure of ours -- the database, CHIP -- is thrown, so the route answers 500 and CHIP
 * sends the message again.
 */
export async function handleChipMessage(
  deps: ChipMessageDeps,
  message: { source: ChipSource; body: unknown },
): Promise<{ status: string }> {
  const purchaseId = bodyId(message.body);
  if (!purchaseId) return { status: 'ignored' };

  // The success callback is only ever sent for a paid purchase; what CHIP says decides.
  if (message.source === 'callback') return grantFromChip(deps, purchaseId, 'callback');

  const event = (message.body as { event_type?: unknown }).event_type;

  if (event === 'purchase.paid') return grantFromChip(deps, purchaseId, 'webhook');

  if (event === 'purchase.payment_failure') {
    const payment = await deps.prisma.payment.findFirst({
      where: { provider: 'CHIP', providerRef: purchaseId },
      select: { id: true, pageId: true, autoRenewal: true },
    });
    // A failed first payment is the owner's to retry at checkout; only a renewal charge
    // is ours to count.
    if (!payment?.autoRenewal || !payment.pageId) return { status: 'ignored' };
    const result = await recordRenewalFailure(deps.prisma, payment.id, new Date());
    deps.log.info({ purchaseId, source: 'webhook', outcome: `renewal-${result.kind}` }, 'chip purchase handled');
    await deps.onRenewalFailure(payment.pageId, result);
    return { status: `renewal-${result.kind}` };
  }
  return { status: 'ignored' };
}

/**
 * How one attempt ended, as the event row keeps it. The status is the one the error handler
 * answers with (`statusFor`, the same function). The error's name only: a refused CHIP call
 * carries CHIP's response body -- the payer's details among it -- in its message.
 */
export function attemptOutcome(failure: { error: unknown } | null) {
  if (!failure) return { outcome: 'ok', statusCode: 200, error: null };
  return { outcome: 'failed', statusCode: statusFor(failure.error), error: errName(failure.error) };
}

/**
 * Logs a verified message, then handles it. One row per source, purchase and event: a
 * resend counts another attempt on the same row and keeps the body it came with. A message
 * that names no purchase is handled (it is ignored) and not logged, as there is nothing in
 * it anyone could replay.
 *
 * The handler's throw is re-raised once the row says so, so CHIP still sees a 500 and
 * sends again. The log never stands in front of the payment: a row that cannot be written
 * -- before the handler or after it -- is logged as a warning, and the message is handled
 * and answered as if the log were not there.
 */
export async function recordAndHandle(
  deps: ChipMessageDeps,
  message: { source: ChipSource; body: unknown; rawBody: string },
): Promise<{ status: string }> {
  const purchaseId = bodyId(message.body);
  if (!purchaseId) return handleChipMessage(deps, message);

  const now = new Date();
  const eventType = eventTypeOf(message.body);
  const key = { source: message.source, purchaseId, eventType };
  const repeat = { body: message.rawBody, attempts: { increment: 1 }, lastAttemptAt: now };

  let eventId: string | null = null;
  try {
    try {
      const event = await deps.prisma.chipWebhookEvent.upsert({
        where: { source_purchaseId_eventType: key },
        create: { ...key, body: message.rawBody, lastAttemptAt: now },
        update: repeat,
        select: { id: true },
      });
      eventId = event.id;
    } catch (error) {
      // Two first deliveries at once: both missed the row, and the other one created it.
      // This one is then a repeat, counted on that row.
      if ((error as { code?: unknown } | null)?.code !== 'P2002') throw error;
      const event = await deps.prisma.chipWebhookEvent.update({
        where: { source_purchaseId_eventType: key },
        data: repeat,
        select: { id: true },
      });
      eventId = event.id;
    }
  } catch (error) {
    deps.log.warn({ purchaseId, source: message.source, err: errName(error) }, 'chip message not logged; handling it anyway');
  }
  if (!eventId) return handleChipMessage(deps, message);
  const id = eventId;

  const settle = async (failure: { error: unknown } | null) => {
    try {
      await deps.prisma.chipWebhookEvent.update({ where: { id }, data: attemptOutcome(failure) });
    } catch (error) {
      deps.log.warn({ purchaseId, source: message.source, err: errName(error) }, 'chip message handled, but its outcome was not recorded');
    }
  };

  let result: { status: string };
  try {
    result = await handleChipMessage(deps, message);
  } catch (error) {
    await settle({ error });
    throw error;
  }
  await settle(null);
  return result;
}

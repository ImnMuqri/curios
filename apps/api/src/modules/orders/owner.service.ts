import { releaseUnpaidStock, type Prisma, type PrismaClient } from '@curios/db';
import type { AvatarStore } from '../pages/storage.js';
import { deliverOrder, queueDeliveryMail, type DeliveryMailDeps } from './deliver.service.js';
import { OrderNotFoundError, OrderStateError } from './order.errors.js';

export interface OwnerOrderDeps {
  prisma: PrismaClient;
  /** Null: uploads are off here, so there is no file to remove. */
  store: AvatarStore | null;
  log?: { warn?: (obj: object, msg: string) => void };
  /** The buyer's delivery email; absent where no mail is queued (tests of the move alone). */
  mail?: DeliveryMailDeps;
}

type Status = 'PLACED' | 'PAID' | 'COMPLETED' | 'CANCELLED';

/**
 * One conditional update: the id, the owner's scope and the state the move
 * needs are all in the `where`, so a double tap (or two tabs) changes nothing
 * the second time. Zero rows is either "not yours" or "already moved on", and
 * one read afterwards says which; the owner scope is in that read too, so
 * another owner's order is indistinguishable from one that does not exist.
 */
async function move(
  prisma: Pick<Prisma.TransactionClient, 'order'>,
  accountId: string,
  id: string,
  where: Prisma.OrderWhereInput,
  data: Prisma.OrderUpdateManyMutationInput,
): Promise<void> {
  const { count } = await prisma.order.updateMany({ where: { ...where, id, page: { accountId } }, data });
  if (count > 0) return;
  const owned = await prisma.order.findFirst({ where: { id, page: { accountId } }, select: { id: true } });
  throw owned ? new OrderStateError() : new OrderNotFoundError();
}

const from = (...statuses: Status[]): Prisma.OrderWhereInput => ({ status: { in: statuses } });

/**
 * The owner says the money arrived: by the receipt the customer sent in, or by
 * hand with none (cash, a transfer they saw in their bank). Which one is read
 * first and then made part of the `where`, so a receipt that lands in between
 * fails the move rather than being recorded as MANUAL.
 */
export async function markPaid(deps: OwnerOrderDeps, accountId: string, id: string, now: Date): Promise<void> {
  const current = await deps.prisma.order.findFirst({ where: { id, page: { accountId } }, select: { receiptKey: true } });
  const receiptKey = current?.receiptKey ?? null;
  // Paid and delivered in one transaction: the order is never PAID with digital lines still unsent.
  const sent = await deps.prisma.$transaction(async (tx) => {
    await move(tx, accountId, id, { ...from('PLACED'), receiptKey }, { status: 'PAID', paidAt: now, paidVia: receiptKey ? 'RECEIPT' : 'MANUAL' });
    return deliverOrder(tx, id, now);
  });
  // After the commit. The owner marked this paid themselves, so they get no email of their own.
  if (sent && deps.mail) await queueDeliveryMail(deps.mail, id);
}

export const markCompleted = (deps: OwnerOrderDeps, accountId: string, id: string, now: Date) =>
  move(deps.prisma, accountId, id, from('PAID'), { status: 'COMPLETED', completedAt: now });

/**
 * Cancelling an order that was never paid gives back its codes and class seats, in the
 * same transaction (releaseUnpaidStock); one that was paid keeps what the buyer was given.
 */
export const cancelOrder = (deps: OwnerOrderDeps, accountId: string, id: string, now: Date) =>
  deps.prisma.$transaction(async (tx) => {
    await move(tx, accountId, id, from('PLACED', 'PAID'), { status: 'CANCELLED', cancelledAt: now });
    await releaseUnpaidStock(tx, id);
  });

/**
 * Money went back, and this says it did: a paid order that was cancelled, or
 * the second payment of an order paid twice (which stays paid otherwise). The
 * two are marked apart (refundedAt, secondRefundedAt), so an order paid twice,
 * refunded once and then cancelled still owes its refund. A cancelled order
 * paid twice whose second payment is still owed is settled by one mark: the
 * screen asks for both back before it.
 */
export async function markRefunded(deps: OwnerOrderDeps, accountId: string, id: string, now: Date): Promise<void> {
  const current = await deps.prisma.order.findFirst({ where: { id, page: { accountId } }, select: { status: true } });
  if (current?.status !== 'CANCELLED') {
    await move(deps.prisma, accountId, id, { ...from('PAID', 'COMPLETED'), chipPaidTwiceAt: { not: null }, secondRefundedAt: null }, { secondRefundedAt: now });
    return;
  }
  await move(deps.prisma, accountId, id, { ...from('CANCELLED'), paidAt: { not: null }, refundedAt: null }, { refundedAt: now });
  await deps.prisma.order.updateMany({
    where: { id, page: { accountId }, status: 'CANCELLED', chipPaidTwiceAt: { not: null }, secondRefundedAt: null },
    data: { secondRefundedAt: now },
  });
}

/**
 * The receipt did not arrive: clear it and mark the rejection, so the order
 * page asks the customer to pay and upload again. Only while the order is
 * PLACED and a receipt is in. The row is cleared against the very key that was
 * read, so a receipt replaced in between is not cleared by mistake; the old
 * file goes after, best-effort, as a replaced receipt's does.
 */
export async function markNotReceived(deps: OwnerOrderDeps, accountId: string, id: string, now: Date): Promise<void> {
  const current = await deps.prisma.order.findFirst({
    where: { id, page: { accountId }, status: 'PLACED', receiptKey: { not: null } },
    select: { receiptKey: true },
  });
  const key = current?.receiptKey ?? null;
  await move(
    deps.prisma,
    accountId,
    id,
    // No receipt to read: let the conditional update fail on its own `where`.
    key ? { status: 'PLACED', receiptKey: key } : { status: 'PLACED', receiptKey: { not: null } },
    { receiptKey: null, receiptType: null, receiptUploadedAt: null, receiptRejectedAt: now },
  );
  if (key && deps.store) {
    await deps.store.remove(key).catch((error: unknown) =>
      deps.log?.warn?.({ orderId: id, err: error instanceof Error ? error.message : String(error) }, 'rejected receipt could not be removed'),
    );
  }
}

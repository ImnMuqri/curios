import type { Prisma, PrismaClient } from '@curios/db';
import type { AvatarStore } from '../pages/storage.js';
import { OrderNotFoundError, OrderStateError } from './order.errors.js';

export interface OwnerOrderDeps {
  prisma: PrismaClient;
  /** Null: uploads are off here, so there is no file to remove. */
  store: AvatarStore | null;
  log?: { warn?: (obj: object, msg: string) => void };
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
  prisma: PrismaClient,
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
  await move(deps.prisma, accountId, id, { ...from('PLACED'), receiptKey }, { status: 'PAID', paidAt: now, paidVia: receiptKey ? 'RECEIPT' : 'MANUAL' });
}

export const markCompleted = (deps: OwnerOrderDeps, accountId: string, id: string, now: Date) =>
  move(deps.prisma, accountId, id, from('PAID'), { status: 'COMPLETED', completedAt: now });

export const cancelOrder = (deps: OwnerOrderDeps, accountId: string, id: string, now: Date) =>
  move(deps.prisma, accountId, id, from('PLACED', 'PAID'), { status: 'CANCELLED', cancelledAt: now });

/** A paid order that was cancelled: the money goes back, and this says it did. */
export const markRefunded = (deps: OwnerOrderDeps, accountId: string, id: string, now: Date) =>
  move(deps.prisma, accountId, id, { status: 'CANCELLED', paidAt: { not: null }, refundedAt: null }, { refundedAt: now });

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

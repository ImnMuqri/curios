import { randomBytes } from 'node:crypto';
import { hashSessionValue, MAIL_QUEUE, receiptMail } from '@curios/core';
import { RECEIPT_MAX_BYTES } from '@curios/core/orders';
import type { PrismaClient } from '@curios/db';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { decodeReceipt } from '../pages/avatar.js';
import { StorageNotConfiguredError } from '../pages/page.routes.js';
import type { AvatarStore } from '../pages/storage.js';
import { StoreBusinessOnlyError } from '../store/store.errors.js';
import { OrderAlreadyPaidError, OrderCancelledError, OrderNotFoundError } from './order.errors.js';
import type { OrderMailQueue } from './place.service.js';

export interface ReceiptDeps {
  prisma: PrismaClient;
  mailQueue: OrderMailQueue;
  /** Null: uploads are switched off in this environment. */
  store: AvatarStore | null;
  log?: { warn?: (obj: object, msg: string) => void };
  appUrl: string;
}

type Refusal = 'paid' | 'cancelled';

const refuse = (status: string): Refusal | null =>
  status === 'PAID' || status === 'COMPLETED' ? 'paid' : status === 'CANCELLED' ? 'cancelled' : null;

const throwRefusal = (refusal: Refusal): never => {
  throw refusal === 'paid' ? new OrderAlreadyPaidError() : new OrderCancelledError();
};

/**
 * Stores the receipt a customer uploads on their order link. The link is the
 * only credential, so the token is hashed and looked up, never compared raw.
 * A second upload replaces the first until the owner has marked the order paid.
 */
export async function uploadReceipt(
  deps: ReceiptDeps,
  token: string,
  input: { contentType: string; data: string },
  now: Date,
): Promise<{ receiptUploadedAt: Date }> {
  const found = await deps.prisma.order.findUnique({
    where: { tokenHash: hashSessionValue(token) },
    select: { id: true, status: true, page: { select: { mode: true, suspendedAt: true } } },
  });
  if (!found) throw new OrderNotFoundError();
  if (found.page.mode !== 'BUSINESS') throw new StoreBusinessOnlyError();
  if (found.page.suspendedAt !== null) throw new PageUnavailableError();
  const early = refuse(found.status);
  if (early) throwRefusal(early);
  if (!deps.store) throw new StorageNotConfiguredError();
  const { body, ext } = decodeReceipt(input, RECEIPT_MAX_BYTES);

  const order = await deps.prisma.order.findUniqueOrThrow({
    where: { id: found.id },
    select: {
      id: true,
      pageId: true,
      number: true,
      totalCents: true,
      customerName: true,
      page: { select: { notifyReceipts: true, account: { select: { email: true } } } },
    },
  });
  // Random, so the URL cannot be guessed and a replaced file is never served stale.
  const key = `receipts/${order.pageId}/${randomBytes(16).toString('hex')}.${ext}`;
  await deps.store.put(key, body, input.contentType);

  let replaced: string | null;
  try {
    // The order row is locked while its receipt is swapped, so two uploads
    // each remove the file the other left rather than orphaning one, and an
    // owner marking it paid either lands before this (refused) or after.
    replaced = await deps.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, receiptKey: true } });
      const refusal = refuse(current.status);
      if (refusal) throwRefusal(refusal);
      await tx.order.update({
        where: { id: order.id },
        data: { receiptKey: key, receiptType: input.contentType, receiptUploadedAt: now, receiptRejectedAt: null },
      });
      return current.receiptKey;
    });
  } catch (error) {
    // Nothing points at the new file: it would be unreachable, and unremoved.
    await deps.store.remove(key).catch(() => undefined);
    throw error;
  }

  if (replaced) {
    await deps.store.remove(replaced).catch((error: unknown) =>
      deps.log?.warn?.({ orderId: order.id, err: error instanceof Error ? error.message : String(error) }, 'replaced receipt could not be removed'),
    );
  }

  if (order.page.notifyReceipts) {
    const warn = (error: unknown) =>
      deps.log?.warn?.({ orderId: order.id, err: error instanceof Error ? error.message : String(error) }, 'could not queue the receipt email');
    try {
      const mail = receiptMail({
        number: order.number,
        totalCents: order.totalCents,
        customerName: order.customerName,
        uploadedAt: now,
        fileName: key.slice(key.lastIndexOf('/') + 1),
        url: `${deps.appUrl.replace(/\/+$/, '')}/app/orders?order=${order.id}`,
        appUrl: deps.appUrl,
      });
      // Not awaited, as the new-order email is not: the reply never waits on the queue.
      void deps.mailQueue
        .add(MAIL_QUEUE, { to: order.page.account.email, ...mail, audience: 'owner' }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true })
        .catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  return { receiptUploadedAt: now };
}

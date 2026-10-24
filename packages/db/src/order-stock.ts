import type { Prisma } from '@prisma/client';

/**
 * Gives back what an order that ends unpaid was holding: its codes go back to
 * the item's free ones (orderLineId null) and its class bookings are deleted,
 * so the seats open again. An order that was paid keeps both: the buyer already
 * had the code, and the seat was theirs. Meant for the transaction that moves
 * the order to CANCELLED, which is also what makes the paidAt read here final:
 * a payment that lands after the cancel is recorded on the cancelled order
 * (owner refunds it), it never takes the code back.
 */
export async function releaseUnpaidStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { paidAt: true } });
  if (!order || order.paidAt !== null) return;
  await tx.sessionBooking.deleteMany({ where: { orderLine: { orderId } } });
  await tx.itemCode.updateMany({ where: { orderLine: { orderId } }, data: { orderLineId: null } });
}

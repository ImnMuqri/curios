import type { Prisma } from '@prisma/client';

/**
 * Gives back what a cancelled order was holding: its class bookings are always
 * deleted, so the seats open again (a paid order's seat is no use to a buyer
 * who was refunded). Its codes go back to the item's free ones (orderLineId
 * null) only if the order was never paid: a paid buyer already had the code,
 * and a code once given cannot be taken back. Meant for the transaction that moves
 * the order to CANCELLED, which is also what makes the paidAt read here final:
 * a payment that lands after the cancel is recorded on the cancelled order
 * (owner refunds it), it never takes the code back.
 */
export async function releaseOrderStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { paidAt: true } });
  if (!order) return;
  await tx.sessionBooking.deleteMany({ where: { orderLine: { orderId } } });
  if (order.paidAt !== null) return;
  await tx.itemCode.updateMany({ where: { orderLine: { orderId } }, data: { orderLineId: null } });
}

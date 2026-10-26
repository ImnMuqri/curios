import { releaseOrderStock, type Prisma, type PrismaClient } from '@curios/db';

export const EXPIRE_HOLDS_JOB = 'expire-holds';

/** How long an unpaid order may hold codes and class seats before they go back on sale. */
export const HOLD_HOURS = 24;

/** Orders looked at per run; the rest wait for the next hour. */
const BATCH = 200;

/**
 * An order that is still unpaid: placed, no payment, no receipt waiting for the owner, and no CHIP
 * purchase a customer could still be paying (none made, or its due time passed).
 */
const stale = (now: Date, before: Date): Prisma.OrderWhereInput => ({
  status: 'PLACED',
  paidAt: null,
  receiptKey: null,
  createdAt: { lt: before },
  OR: [{ chipPurchaseDueAt: null }, { chipPurchaseDueAt: { lte: now } }],
});

/**
 * Cancels orders that sat unpaid for a day while holding a code or a class seat, and gives both back,
 * so anonymous orders cannot sell out a voucher or a class for good. Each order is one transaction:
 * the conditional update (the same `where` again, so an order paid or given a receipt in between is
 * left alone) and then the owner's own release. A payment that lands at CHIP afterwards is recorded on
 * the cancelled order by the existing paid-after-cancel path (the purchase id is kept), and the owner
 * refunds it. Safe to run twice: the second run finds nothing.
 */
export async function expireUnpaidHolds(deps: { prisma: PrismaClient; now: Date; log?: { info: (details: object, message: string) => void } }): Promise<number> {
  const before = new Date(deps.now.getTime() - HOLD_HOURS * 3_600_000);
  const where = stale(deps.now, before);
  const holding = await deps.prisma.order.findMany({
    where: { ...where, lines: { some: { OR: [{ codes: { some: {} } }, { booking: { isNot: null } }] } } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  let cancelled = 0;
  for (const { id } of holding) {
    const done = await deps.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { ...where, id }, data: { status: 'CANCELLED', cancelledAt: deps.now } });
      if (count === 0) return false;
      await releaseOrderStock(tx, id);
      return true;
    });
    if (done) cancelled += 1;
  }
  if (cancelled > 0) deps.log?.info({ cancelled }, 'unpaid holds released');
  return cancelled;
}

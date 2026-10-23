-- The second payment of an order paid twice gets its own refund mark, apart from
-- refundedAt (a cancelled order's refund). Until now one column held both, so an
-- order paid twice, refunded once and then cancelled could not record the refund
-- it still owed. Hand-written.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "secondRefundedAt" TIMESTAMP(3);

-- An order paid twice that was marked refunded: that mark was the second payment's.
UPDATE "Order" SET "secondRefundedAt" = "refundedAt"
WHERE "chipPaidTwiceAt" IS NOT NULL AND "refundedAt" IS NOT NULL;

-- Unless it was cancelled, refundedAt meant only that, so it goes. A cancelled one
-- keeps both: its single mark settled the order, as the screen said at the time.
UPDATE "Order" SET "refundedAt" = NULL
WHERE "chipPaidTwiceAt" IS NOT NULL AND "refundedAt" IS NOT NULL AND "status" <> 'CANCELLED';

-- When an order's current CHIP purchase stops being payable (due_strict), so the order
-- page can stop waiting on it and disconnecting CHIP can wait for it.
-- Hand-written.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "chipPurchaseDueAt" TIMESTAMP(3);

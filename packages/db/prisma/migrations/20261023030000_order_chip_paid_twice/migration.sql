-- When CHIP took a payment for an order that was already paid another way (the owner's
-- QR, or marked paid by hand): the customer paid twice, and the owner owes one back.
-- Hand-written.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "chipPaidTwiceAt" TIMESTAMP(3);

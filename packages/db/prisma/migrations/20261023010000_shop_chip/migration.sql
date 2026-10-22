-- A shop's own CHIP account, and how an order was paid.
-- Hand-written.

-- CreateEnum
CREATE TYPE "OrderPaidVia" AS ENUM ('RECEIPT', 'MANUAL', 'CHIP');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paidVia" "OrderPaidVia",
ADD COLUMN "chipPurchaseId" TEXT,
ADD COLUMN "payerEmail" TEXT,
ADD COLUMN "paidMethodLabel" TEXT,
ADD COLUMN "paidRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_chipPurchaseId_key" ON "Order"("chipPurchaseId");

-- CreateTable
CREATE TABLE "ShopPaymentAccount" (
    "pageId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'CHIP',
    "brandId" TEXT NOT NULL,
    "brandName" TEXT,
    "secretKeyCiphertext" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "methods" TEXT[],
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "ShopPaymentAccount_pkey" PRIMARY KEY ("pageId")
);

-- AddForeignKey
ALTER TABLE "ShopPaymentAccount" ADD CONSTRAINT "ShopPaymentAccount_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The web app's read-only role reads every column but the sealed key. The
-- default privileges in readonly-role.sql granted it the whole table the moment
-- it was created; that is narrowed here, where the role exists, and again in
-- readonly-role.sql, which re-grants every table when it is re-run.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'curios_readonly') THEN
    REVOKE SELECT ON "ShopPaymentAccount" FROM curios_readonly;
    GRANT SELECT ("pageId", "provider", "brandId", "brandName", "publicKeyPem", "methods", "isTest", "connectedAt", "checkedAt", "lastErrorAt")
      ON "ShopPaymentAccount" TO curios_readonly;
  END IF;
END $$;

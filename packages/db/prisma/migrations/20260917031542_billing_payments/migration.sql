-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "billplzCollectionId" TEXT NOT NULL,
    "billplzBillId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "grantedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_billplzBillId_key" ON "Payment"("billplzBillId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_pageId_createdAt_idx" ON "Payment"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

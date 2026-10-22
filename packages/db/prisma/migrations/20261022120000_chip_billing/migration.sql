-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'FAILED';
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('BILLPLZ', 'CHIP');

-- AlterTable: every payment that exists today went through Billplz.
ALTER TABLE "Payment" ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'CHIP';
UPDATE "Payment" SET "provider" = 'BILLPLZ';

ALTER TABLE "Payment" RENAME COLUMN "billplzBillId" TO "providerRef";
ALTER INDEX "Payment_billplzBillId_key" RENAME TO "Payment_providerRef_key";

ALTER TABLE "Payment" ALTER COLUMN "billplzCollectionId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "autoRenewal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RenewalCard" (
    "pageId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "cardLabel" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalCard_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "RenewalCard_token_key" ON "RenewalCard"("token");

-- AddForeignKey
ALTER TABLE "RenewalCard" ADD CONSTRAINT "RenewalCard_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

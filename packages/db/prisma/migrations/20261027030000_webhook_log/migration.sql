-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "paidVia" TEXT;

-- CreateTable
CREATE TABLE "ChipWebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT,
    "statusCode" INTEGER,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChipWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChipWebhookEvent_source_purchaseId_eventType_key" ON "ChipWebhookEvent"("source", "purchaseId", "eventType");

-- CreateIndex
CREATE INDEX "ChipWebhookEvent_lastAttemptAt_idx" ON "ChipWebhookEvent"("lastAttemptAt");

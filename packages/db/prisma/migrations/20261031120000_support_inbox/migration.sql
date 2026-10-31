-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'DONE', 'SPAM');

-- CreateEnum
CREATE TYPE "SupportDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "SupportSendStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "SupportThread" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "accountId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "SupportDirection" NOT NULL,
    "messageId" TEXT NOT NULL,
    "resendEmailId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddresses" TEXT[],
    "subject" TEXT NOT NULL,
    "text" TEXT,
    "html" TEXT,
    "sendStatus" "SupportSendStatus",
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "resendAttachmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentId" TEXT,
    "inline" BOOLEAN NOT NULL,
    "storageKey" TEXT NOT NULL,

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportThread_status_lastMessageAt_idx" ON "SupportThread"("status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_resendEmailId_key" ON "SupportMessage"("resendEmailId");

-- CreateIndex
CREATE INDEX "SupportMessage_messageId_idx" ON "SupportMessage"("messageId");

-- CreateIndex
CREATE INDEX "SupportMessage_threadId_createdAt_idx" ON "SupportMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAttachment_storageKey_key" ON "SupportAttachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAttachment_messageId_resendAttachmentId_key" ON "SupportAttachment"("messageId", "resendAttachmentId");

-- AddForeignKey
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mail from outside is the most personal thing in the database. Like Report and ChipWebhookEvent,
-- narrow the read-only role here rather than trust readonly-role.sql to run: it may see a thread's
-- status, owner and times, but not who wrote or what about, and nothing of a message or attachment.
-- Keep these lists in step with readonly-role.sql. Skipped when the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'curios_readonly') THEN
    REVOKE SELECT ON "SupportThread" FROM curios_readonly;
    GRANT SELECT ("id", "status", "unread", "accountId", "lastMessageAt", "createdAt")
      ON "SupportThread" TO curios_readonly;

    REVOKE SELECT ON "SupportMessage" FROM curios_readonly;
    REVOKE SELECT ON "SupportAttachment" FROM curios_readonly;
  END IF;
END $$;

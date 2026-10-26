-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('PHYSICAL', 'DIGITAL');

-- CreateEnum
CREATE TYPE "DigitalDelivery" AS ENUM ('FILES', 'LINK', 'CODES', 'SESSION');

-- CreateEnum
CREATE TYPE "SessionPlace" AS ENUM ('ONLINE', 'IN_PERSON');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "kind" "ItemKind" NOT NULL DEFAULT 'PHYSICAL',
ADD COLUMN "delivery" "DigitalDelivery",
ADD COLUMN "accessUrl" TEXT,
ADD COLUMN "accessNote" TEXT,
ADD COLUMN "sessionMinutes" INTEGER,
ADD COLUMN "sessionPlace" "SessionPlace",
ADD COLUMN "sessionWhere" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "kind" "ItemKind" NOT NULL DEFAULT 'PHYSICAL',
ADD COLUMN "delivery" "DigitalDelivery",
ADD COLUMN "linkOpenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "method" DROP NOT NULL,
ALTER COLUMN "day" DROP NOT NULL,
ADD COLUMN "email" TEXT,
ADD COLUMN "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ItemFile" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCode" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderLineId" TEXT,
    "givenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSession" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionBooking" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadGrant" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "fileId" TEXT,
    "fileName" TEXT NOT NULL,
    "usesLeft" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DownloadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemFile_itemId_position_idx" ON "ItemFile"("itemId", "position");

-- CreateIndex
CREATE INDEX "ItemCode_itemId_orderLineId_idx" ON "ItemCode"("itemId", "orderLineId");

-- CreateIndex
CREATE INDEX "ItemCode_orderLineId_idx" ON "ItemCode"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCode_itemId_code_key" ON "ItemCode"("itemId", "code");

-- CreateIndex
CREATE INDEX "ItemSession_itemId_startsAt_idx" ON "ItemSession"("itemId", "startsAt");

-- CreateIndex
CREATE INDEX "SessionBooking_sessionId_idx" ON "SessionBooking"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionBooking_orderLineId_key" ON "SessionBooking"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadGrant_token_key" ON "DownloadGrant"("token");

-- CreateIndex
CREATE INDEX "DownloadGrant_orderLineId_idx" ON "DownloadGrant"("orderLineId");

-- CreateIndex
CREATE INDEX "DownloadGrant_fileId_idx" ON "DownloadGrant"("fileId");

-- AddForeignKey
ALTER TABLE "ItemFile" ADD CONSTRAINT "ItemFile_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCode" ADD CONSTRAINT "ItemCode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCode" ADD CONSTRAINT "ItemCode_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSession" ADD CONSTRAINT "ItemSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionBooking" ADD CONSTRAINT "SessionBooking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ItemSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionBooking" ADD CONSTRAINT "SessionBooking_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ItemFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

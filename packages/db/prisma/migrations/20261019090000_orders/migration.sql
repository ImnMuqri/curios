-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'PAID', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "pendingOrderId" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "closedDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "notifyOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyReceipts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ordersAtTrialReset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ordersPlaced" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "method" "OrderMethod" NOT NULL,
    "day" DATE NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "itemsCents" INTEGER NOT NULL,
    "deliveryCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "receiptKey" TEXT,
    "receiptType" TEXT,
    "receiptUploadedAt" TIMESTAMP(3),
    "receiptRejectedAt" TIMESTAMP(3),
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "optionLabel" TEXT,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_tokenHash_key" ON "Order"("tokenHash");

-- CreateIndex
CREATE INDEX "Order_pageId_createdAt_idx" ON "Order"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_pageId_number_key" ON "Order"("pageId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_pageId_code_key" ON "Order"("pageId", "code");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_pendingOrderId_fkey" FOREIGN KEY ("pendingOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

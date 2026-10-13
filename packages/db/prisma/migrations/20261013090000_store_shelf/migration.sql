-- Slice 17: the shelf. Items, their options, and a page's shop settings.
-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('NONE', 'FLAT', 'RIDER');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "deliveryFeeCents" INTEGER,
ADD COLUMN     "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "minNoticeDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paymentQrKey" TEXT,
ADD COLUMN     "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupNote" TEXT,
ADD COLUMN     "shopTilePosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shopTileSize" "TileSize",
ADD COLUMN     "storeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "photoKey" TEXT,
    "priceCents" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemOption" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ItemOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Item_pageId_position_idx" ON "Item"("pageId", "position");

-- CreateIndex
CREATE INDEX "ItemOption_itemId_position_idx" ON "ItemOption"("itemId", "position");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOption" ADD CONSTRAINT "ItemOption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;


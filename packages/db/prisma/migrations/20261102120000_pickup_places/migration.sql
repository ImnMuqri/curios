-- CreateTable
CREATE TABLE "PickupPlace" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mapUrl" TEXT,
    "note" TEXT,
    "anyTime" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupWindow" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "fromMinute" INTEGER NOT NULL,
    "toMinute" INTEGER NOT NULL,
    "limit" INTEGER,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PickupWindow_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "pickupPlaceId" TEXT,
ADD COLUMN "pickupPlaceName" TEXT,
ADD COLUMN "pickupPlaceAddress" TEXT,
ADD COLUMN "pickupWindowId" TEXT,
ADD COLUMN "pickupFrom" INTEGER,
ADD COLUMN "pickupTo" INTEGER,
ADD COLUMN "chipTriedMethod" TEXT;

-- CreateIndex
CREATE INDEX "PickupPlace_pageId_position_idx" ON "PickupPlace"("pageId", "position");

-- CreateIndex
CREATE INDEX "PickupWindow_placeId_position_idx" ON "PickupWindow"("placeId", "position");

-- CreateIndex
CREATE INDEX "Order_pickupWindowId_day_idx" ON "Order"("pickupWindowId", "day");

-- AddForeignKey
ALTER TABLE "PickupPlace" ADD CONSTRAINT "PickupPlace_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupWindow" ADD CONSTRAINT "PickupWindow_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "PickupPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupPlaceId_fkey" FOREIGN KEY ("pickupPlaceId") REFERENCES "PickupPlace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupWindowId_fkey" FOREIGN KEY ("pickupWindowId") REFERENCES "PickupWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A shop that had pickup on, or a note about it, gets one place from them: the note becomes
-- its address, and it is open any time that day, as pickup was before places existed.
INSERT INTO "PickupPlace" ("id", "pageId", "name", "address", "anyTime", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", 'Pickup', COALESCE("pickupNote", ''), true, 0, now()
FROM "Page" WHERE "pickupEnabled" OR "pickupNote" IS NOT NULL;

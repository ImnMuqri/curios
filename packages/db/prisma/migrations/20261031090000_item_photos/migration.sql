-- CreateTable
CREATE TABLE "ItemPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "originalKey" TEXT NOT NULL,
    "squareKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "frameX" DOUBLE PRECISION NOT NULL,
    "frameY" DOUBLE PRECISION NOT NULL,
    "frameSize" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemPhoto_itemId_position_idx" ON "ItemPhoto"("itemId", "position");

-- AddForeignKey
ALTER TABLE "ItemPhoto" ADD CONSTRAINT "ItemPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

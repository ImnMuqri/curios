-- AlterTable
ALTER TABLE "Item" ADD COLUMN "choiceGroupOne" TEXT,
ADD COLUMN "choiceGroupTwo" TEXT;

-- AlterTable
ALTER TABLE "ItemOption" ADD COLUMN "choiceOneId" TEXT,
ADD COLUMN "choiceTwoId" TEXT,
ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ItemChoice" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "group" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "photoId" TEXT,

    CONSTRAINT "ItemChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemChoice_itemId_group_position_idx" ON "ItemChoice"("itemId", "group", "position");

-- AddForeignKey
ALTER TABLE "ItemChoice" ADD CONSTRAINT "ItemChoice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChoice" ADD CONSTRAINT "ItemChoice_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ItemPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOption" ADD CONSTRAINT "ItemOption_choiceOneId_fkey" FOREIGN KEY ("choiceOneId") REFERENCES "ItemChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOption" ADD CONSTRAINT "ItemOption_choiceTwoId_fkey" FOREIGN KEY ("choiceTwoId") REFERENCES "ItemChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

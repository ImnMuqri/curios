-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('CHAT', 'ENQUIRY');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "askForPrice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "itemId" TEXT,
ADD COLUMN "kind" "LeadKind" NOT NULL DEFAULT 'CHAT',
ADD COLUMN "name" TEXT,
ADD COLUMN "note" TEXT;

-- CreateIndex
CREATE INDEX "Lead_itemId_idx" ON "Lead"("itemId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

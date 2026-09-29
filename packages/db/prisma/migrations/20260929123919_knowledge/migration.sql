-- CreateEnum
CREATE TYPE "FactOrigin" AS ENUM ('EXTRACTED', 'OWNER', 'UNTRACKED');

-- AlterTable
ALTER TABLE "Fact" ADD COLUMN     "ingestionId" TEXT,
ADD COLUMN     "origin" "FactOrigin" NOT NULL DEFAULT 'EXTRACTED';

-- AlterTable
ALTER TABLE "Ingestion" ADD COLUMN     "tracked" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Fact_ingestionId_idx" ON "Fact"("ingestionId");

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_ingestionId_fkey" FOREIGN KEY ("ingestionId") REFERENCES "Ingestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill. Everything already in the database predates source tracking.
-- The column defaults stay EXTRACTED / true for rows written from now on.
UPDATE "Fact" SET "origin" = 'UNTRACKED';
UPDATE "Ingestion" SET "tracked" = false;

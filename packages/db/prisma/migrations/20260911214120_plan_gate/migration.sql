-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "leadsCaptured" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paidUntil" TIMESTAMP(3);

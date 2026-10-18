-- How far through its source a read has got, 0 to 100, for the bar while it reads.
ALTER TABLE "Ingestion" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;

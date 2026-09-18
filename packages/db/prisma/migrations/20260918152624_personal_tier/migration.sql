-- AlterTable
ALTER TABLE "Ingestion" ADD COLUMN     "pastedText" TEXT,
ALTER COLUMN "sourceUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "allowSearchIndexing" BOOLEAN NOT NULL DEFAULT false;

-- Exactly one source per ingestion. Prisma cannot express a CHECK, so it is
-- written here. The API refuses both and neither before writing; this is what
-- holds if anything ever writes around the API. Every existing row has a
-- sourceUrl and no pastedText, so it satisfies the constraint as it is added.
ALTER TABLE "Ingestion" ADD CONSTRAINT "Ingestion_one_source"
  CHECK (("sourceUrl" IS NULL) <> ("pastedText" IS NULL));

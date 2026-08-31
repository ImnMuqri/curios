-- Nullable first: Page already holds rows, so a bare NOT NULL column fails here.
ALTER TABLE "Page" ADD COLUMN "skeleton" TEXT;

-- Backfill. Every existing handle is lowercase ASCII, so the two digit folds
-- are the whole algorithm for them. New rows compute the skeleton in
-- application code, where NFKD and combining-mark stripping are available;
-- this statement is not that algorithm and is not meant to be reused.
UPDATE "Page" SET "skeleton" = replace(replace(lower("handle"), '0', 'o'), '1', 'i')
WHERE "skeleton" IS NULL;

ALTER TABLE "Page" ALTER COLUMN "skeleton" SET NOT NULL;

CREATE UNIQUE INDEX "Page_skeleton_key" ON "Page"("skeleton");

-- One page per account, previously a convention enforced nowhere.
CREATE UNIQUE INDEX "Page_accountId_key" ON "Page"("accountId");

ALTER TABLE "Fact" ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- One open report per visitor address per page: a visitor who reports a page again while their
-- first report is still open adds nothing. Partial, so a dismissed or acted-on report does not stop
-- the same address reporting the page again later. The API checks before it inserts and takes a
-- unique violation here as the same quiet answer, so two reports sent at once still make one row.
--
-- Prisma's schema cannot express a partial index, so it lives only here (see the note on
-- model Report). A future `prisma migrate diff` from the schema would propose dropping it: leave
-- that line out.
--
-- Any open duplicates already stored are kept as the oldest one per address and page; the rest are
-- marked DISMISSED so the index can be built.
UPDATE "Report" r
SET "status" = 'DISMISSED', "decidedAt" = CURRENT_TIMESTAMP
WHERE r."status" = 'OPEN'
  AND EXISTS (
    SELECT 1 FROM "Report" o
    WHERE o."pageId" = r."pageId"
      AND o."reporterIpHash" = r."reporterIpHash"
      AND o."status" = 'OPEN'
      AND (o."createdAt", o."id") < (r."createdAt", r."id")
  );

CREATE UNIQUE INDEX "Report_open_page_reporter_key" ON "Report" ("pageId", "reporterIpHash") WHERE "status" = 'OPEN';

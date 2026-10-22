-- Item link words, categories, tags, and the shop's halal switch.
-- Hand-written: the slug column is added nullable, backfilled from each name,
-- then made required and unique per page.

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "slug" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "tag" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "shopHalal" BOOLEAN NOT NULL DEFAULT false;

-- Backfill. The base is the lowercased name with every run of characters
-- outside a-z0-9 turned into one hyphen, trimmed, cut to 60, and "item" when
-- nothing is left (a Chinese name, say). Repeats on one page are numbered -2,
-- -3 in order of createdAt then id, so the result is the same on every run.
WITH based AS (
  SELECT
    "id",
    "pageId",
    "createdAt",
    COALESCE(
      NULLIF(
        trim(both '-' from left(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 60)),
        ''
      ),
      'item'
    ) AS "base"
  FROM "Item"
),
numbered AS (
  SELECT
    "id",
    "pageId",
    "base",
    row_number() OVER (PARTITION BY "pageId", "base" ORDER BY "createdAt", "id") AS "n"
  FROM based
)
UPDATE "Item" AS i
SET "slug" = CASE WHEN numbered."n" = 1 THEN numbered."base" ELSE numbered."base" || '-' || numbered."n" END
FROM numbered
WHERE i."id" = numbered."id";

-- A numbered slug can still meet a name that already reads like it ("kek-2"
-- beside two "kek"). Whatever still repeats on a page gets its id appended.
WITH repeated AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "pageId", "slug" ORDER BY "createdAt", "id") AS "n"
  FROM "Item"
)
UPDATE "Item" AS i
SET "slug" = i."slug" || '-' || lower(i."id")
FROM repeated
WHERE i."id" = repeated."id" AND repeated."n" > 1;

ALTER TABLE "Item" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Item_pageId_slug_key" ON "Item"("pageId", "slug");

-- Topics: one per thing visitors ask.
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleSetByOwner" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "conflictAnswer" TEXT,
    "askCount" INTEGER NOT NULL DEFAULT 0,
    "faqSlug" TEXT,
    "faqSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Topic_pageId_faqSlug_key" ON "Topic"("pageId", "faqSlug");
CREATE INDEX "Topic_pageId_askCount_idx" ON "Topic"("pageId", "askCount");
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FaqRedirect" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "topicId" TEXT,
    CONSTRAINT "FaqRedirect_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaqRedirect_pageId_slug_key" ON "FaqRedirect"("pageId", "slug");
ALTER TABLE "FaqRedirect" ADD CONSTRAINT "FaqRedirect_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaqRedirect" ADD CONSTRAINT "FaqRedirect_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Question" ADD COLUMN "topicId" TEXT,
ADD COLUMN "groupedAt" TIMESTAMP(3),
ADD COLUMN "pinnedByOwner" BOOLEAN NOT NULL DEFAULT false;

-- Backfill. One topic per existing question, reusing the question's id as the
-- topic's id (unique, and a valid id), carrying its pinned answer, slug,
-- suppression, count and dates. groupedAt stays null so the one-off grouping
-- picks every existing question up.
INSERT INTO "Topic" ("id", "pageId", "title", "answer", "answeredAt", "askCount", "faqSlug", "faqSuppressed", "createdAt", "lastAskedAt")
SELECT q."id", q."pageId", q."text", p."answer",
       CASE WHEN p."answer" IS NULL THEN NULL ELSE q."lastAskedAt" END,
       q."askCount", q."faqSlug", q."faqSuppressed", q."firstAskedAt", q."lastAskedAt"
FROM "Question" q
LEFT JOIN "PinnedAnswer" p ON p."pageId" = q."pageId" AND p."normalizedQuestion" = q."normalizedQuestion";

UPDATE "Question" SET "topicId" = "id";

ALTER TABLE "Question" ALTER COLUMN "topicId" SET NOT NULL;
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Question_topicId_idx" ON "Question"("topicId");

DROP INDEX "Question_pageId_faqSlug_key";
ALTER TABLE "Question" DROP COLUMN "answered",
DROP COLUMN "faqSlug",
DROP COLUMN "faqSuppressed";

DROP TABLE "PinnedAnswer";

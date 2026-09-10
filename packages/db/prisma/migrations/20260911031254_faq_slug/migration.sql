-- AlterTable
ALTER TABLE "Question" ADD COLUMN "faqSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Question_pageId_faqSlug_key" ON "Question"("pageId", "faqSlug");

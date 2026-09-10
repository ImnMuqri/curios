-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "askCount" INTEGER NOT NULL DEFAULT 1,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "firstAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_pageId_askCount_idx" ON "Question"("pageId", "askCount");

-- CreateIndex
CREATE UNIQUE INDEX "Question_pageId_normalizedQuestion_key" ON "Question"("pageId", "normalizedQuestion");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

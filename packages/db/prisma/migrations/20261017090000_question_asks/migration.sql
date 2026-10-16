-- One row each time a wording is asked, for the Questions screen's week of asks.
CREATE TABLE "QuestionAsk" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAsk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestionAsk_questionId_askedAt_idx" ON "QuestionAsk"("questionId", "askedAt");

ALTER TABLE "QuestionAsk" ADD CONSTRAINT "QuestionAsk_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

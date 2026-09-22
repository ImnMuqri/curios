-- CreateTable
CREATE TABLE "FactEmbedding" (
    "factId" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactEmbedding_pkey" PRIMARY KEY ("factId")
);

-- CreateTable
CREATE TABLE "QuestionEmbedding" (
    "key" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionEmbedding_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "FactEmbedding" ADD CONSTRAINT "FactEmbedding_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

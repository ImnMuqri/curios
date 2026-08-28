-- CreateEnum
CREATE TYPE "PageMode" AS ENUM ('PERSONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "FactCategory" AS ENUM ('PRICE', 'HOURS', 'LOCATION', 'POLICY', 'PRODUCT', 'PERSON', 'MISC');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "mode" "PageMode" NOT NULL DEFAULT 'BUSINESS',
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "category" "FactCategory" NOT NULL,
    "claim" TEXT NOT NULL,
    "normalizedClaim" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "volatile" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinnedAnswer" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "PinnedAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeverSay" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,

    CONSTRAINT "NeverSay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citedFactIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingestion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'QUEUED',
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL,
    "pageId" TEXT,
    "conversationId" TEXT,
    "ingestionId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costMilliCents" INTEGER NOT NULL,
    "priceVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE INDEX "AuthIdentity_accountId_idx" ON "AuthIdentity"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_handle_key" ON "Page"("handle");

-- CreateIndex
CREATE INDEX "Link_pageId_position_idx" ON "Link"("pageId", "position");

-- CreateIndex
CREATE INDEX "Fact_pageId_category_idx" ON "Fact"("pageId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Fact_pageId_normalizedClaim_key" ON "Fact"("pageId", "normalizedClaim");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedAnswer_pageId_normalizedQuestion_key" ON "PinnedAnswer"("pageId", "normalizedQuestion");

-- CreateIndex
CREATE INDEX "NeverSay_pageId_idx" ON "NeverSay"("pageId");

-- CreateIndex
CREATE INDEX "Conversation_pageId_createdAt_idx" ON "Conversation"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_pageId_period_key" ON "UsageCounter"("pageId", "period");

-- CreateIndex
CREATE INDEX "Ingestion_pageId_createdAt_idx" ON "Ingestion"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_pageId_createdAt_idx" ON "ModelCall"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedAnswer" ADD CONSTRAINT "PinnedAnswer_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeverSay" ADD CONSTRAINT "NeverSay_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingestion" ADD CONSTRAINT "Ingestion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

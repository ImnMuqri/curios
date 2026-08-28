-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordCredential_accountId_key" ON "PasswordCredential"("accountId");

-- CreateIndex
CREATE INDEX "AuthToken_accountId_kind_idx" ON "AuthToken"("accountId", "kind");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

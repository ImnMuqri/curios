-- CreateEnum
CREATE TYPE "HelpVia" AS ENUM ('CHAT', 'TOPIC');

-- CreateTable
CREATE TABLE "HelpQuestion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "screen" TEXT NOT NULL,
    "via" "HelpVia" NOT NULL,
    "question" TEXT,
    "answer" TEXT,
    "entryId" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "helped" BOOLEAN,
    "sentToSupport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpQuestion_createdAt_idx" ON "HelpQuestion"("createdAt");

-- CreateIndex
CREATE INDEX "HelpQuestion_accountId_createdAt_idx" ON "HelpQuestion"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "HelpQuestion" ADD CONSTRAINT "HelpQuestion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Who asked and what: the read-only role (the web and admin apps) counts the rows but reads neither.
-- The admin's list of questions comes through the admin API. Keep in step with readonly-role.sql.
-- Skipped when the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'curios_readonly') THEN
    REVOKE SELECT ON "HelpQuestion" FROM curios_readonly;
    GRANT SELECT ("id", "screen", "via", "entryId", "ok", "helped", "sentToSupport", "createdAt")
      ON "HelpQuestion" TO curios_readonly;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX "ModelCall_createdAt_idx" ON "ModelCall"("createdAt");

-- CreateIndex
CREATE INDEX "QuestionAsk_answered_askedAt_idx" ON "QuestionAsk"("answered", "askedAt");

-- The read-only role gets every new table whole from its default privileges, until
-- readonly-role.sql narrows it again after `migrate deploy`. Two tables hold a column the role must
-- never read, so narrow them here too: the guarantee then holds even if that script is skipped or
-- has not run yet. Keep these lists in step with readonly-role.sql. A migration that adds a
-- PII column does the same inline (see devDocs/OPERATIONS.md, "The read-only role after a deploy").
-- Skipped when the role does not exist (a database the role was never made on).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'curios_readonly') THEN
    REVOKE SELECT ON "Report" FROM curios_readonly;
    GRANT SELECT ("id", "pageId", "reason", "details", "status", "decidedById", "decidedAt", "createdAt")
      ON "Report" TO curios_readonly;

    REVOKE SELECT ON "ChipWebhookEvent" FROM curios_readonly;
    GRANT SELECT ("id", "source", "eventType", "purchaseId", "attempts", "outcome", "statusCode", "error", "receivedAt", "lastAttemptAt")
      ON "ChipWebhookEvent" TO curios_readonly;
  END IF;
END $$;

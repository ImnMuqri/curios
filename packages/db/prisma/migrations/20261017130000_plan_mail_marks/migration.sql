-- Once-only marks for the plan emails: the monthly limit (per usage period)
-- and the plan ending on the day (per paidUntil).
ALTER TABLE "UsageCounter" ADD COLUMN "capMailedAt" TIMESTAMP(3);
ALTER TABLE "Page" ADD COLUMN "planEndedMailFor" TIMESTAMP(3);

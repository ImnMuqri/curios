-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "renewalReminderFor" TIMESTAMP(3),
ADD COLUMN     "trialResetAt" TIMESTAMP(3);

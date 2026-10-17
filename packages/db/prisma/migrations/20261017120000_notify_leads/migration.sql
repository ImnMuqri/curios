-- Whether the owner is emailed each lead (Settings, "Email me when"). On by default.
ALTER TABLE "Page" ADD COLUMN "notifyLeads" BOOLEAN NOT NULL DEFAULT true;

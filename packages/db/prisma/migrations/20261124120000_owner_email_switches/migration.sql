-- Settings, "Email me when": a question asked 3 times (off by default, as the Dash board draws it)
-- and the plan ending (on by default). A topic remembers when its 3-asks email went, so it goes once.
ALTER TABLE "Page" ADD COLUMN "notifyQuestions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Page" ADD COLUMN "notifyPlanEnding" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Topic" ADD COLUMN "askedMailedAt" TIMESTAMP(3);

-- Social profiles shown as icons under the name on the public page.
ALTER TABLE "Page" ADD COLUMN "socials" JSONB NOT NULL DEFAULT '{}';

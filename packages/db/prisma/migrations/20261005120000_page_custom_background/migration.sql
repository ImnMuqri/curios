-- A background in the owner's own colour, beside the five palette bands.
ALTER TYPE "PageBackground" ADD VALUE 'CUSTOM';
ALTER TABLE "Page" ADD COLUMN "backgroundColor" TEXT;

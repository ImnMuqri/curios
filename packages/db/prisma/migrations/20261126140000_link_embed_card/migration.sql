-- A Spotify card shows the title and cover Spotify gave at save time.
ALTER TABLE "Link" ADD COLUMN "embedTitle" TEXT,
ADD COLUMN "embedImage" TEXT;

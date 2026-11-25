-- A link row can be a widget (Spotify, YouTube, a map, a booking page...). Every existing row becomes a plain LINK, so nothing changes for today's pages.
CREATE TYPE "LinkKind" AS ENUM ('LINK', 'WIDGET');
CREATE TYPE "WidgetProvider" AS ENUM ('SPOTIFY', 'APPLE_MUSIC', 'YOUTUBE', 'SOUNDCLOUD', 'GOOGLE_MAPS', 'CALCOM', 'CALENDLY', 'CANVA');
ALTER TABLE "Link" ADD COLUMN "kind" "LinkKind" NOT NULL DEFAULT 'LINK';
ALTER TABLE "Link" ADD COLUMN "provider" "WidgetProvider";
ALTER TABLE "Link" ADD COLUMN "embedRef" TEXT;

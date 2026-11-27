-- Pictures and GIF widgets: how they show, their description, and their pictures.
CREATE TYPE "PictureMode" AS ENUM ('CAROUSEL', 'GRID', 'FULL', 'SQUARE');

ALTER TABLE "Link" ADD COLUMN "pictureMode" "PictureMode",
ADD COLUMN "altText" TEXT;

CREATE TABLE "LinkPicture" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkPicture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkPicture_linkId_position_idx" ON "LinkPicture"("linkId", "position");

ALTER TABLE "LinkPicture" ADD CONSTRAINT "LinkPicture_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

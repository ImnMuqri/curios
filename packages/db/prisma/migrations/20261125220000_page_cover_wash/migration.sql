-- Full page cover: the page colour over the photo, or the photo as it is. True keeps every page as it is today.
ALTER TABLE "Page" ADD COLUMN "coverWash" BOOLEAN NOT NULL DEFAULT true;

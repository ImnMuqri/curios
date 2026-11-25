-- List used to always draw the shop first, so any position stored before the
-- Layout tab existed was invisible. Layout now honours the stored position;
-- resetting it to 0 keeps every existing page looking exactly as it does today.
UPDATE "Page" SET "shopTilePosition" = 0 WHERE "shopTilePosition" <> 0;

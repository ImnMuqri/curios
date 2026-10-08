-- The brand moved from hijau to biru. Only the default changes: a page already
-- on #0c7a62 may have picked it, and Hijau is still one of the presets.
ALTER TABLE "Page" ALTER COLUMN "accentColor" SET DEFAULT '#2340c8';

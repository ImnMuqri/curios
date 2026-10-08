-- A cover photo and a background band for the public page. Every existing page
-- keeps the look it had: PAPER, and no cover.
CREATE TYPE "PageBackground" AS ENUM ('PAPER', 'MUDA', 'KUNING', 'BIRU', 'INK');

ALTER TABLE "Page"
  ADD COLUMN "coverKey" TEXT,
  ADD COLUMN "background" "PageBackground" NOT NULL DEFAULT 'PAPER';

-- How the page is laid out: a list of links (every page so far) or a bento grid.
CREATE TYPE "PageLayout" AS ENUM ('LIST', 'BENTO');
ALTER TABLE "Page" ADD COLUMN "layout" "PageLayout" NOT NULL DEFAULT 'LIST';
